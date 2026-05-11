/**
 * Agent Detection Service — passive detection of AI coding agents running
 * inside gnar-term terminals.
 *
 * This is a core-owned feature. Detection is always-on: every terminal
 * surface across every workspace is observed from app startup, and every
 * consumer (the orchestrator extension, future slack-ping/audit-log/
 * watchdog extensions, or core UI chrome) reads the same agent registry.
 *
 * What it does:
 *   1. On init, bootstraps tracking for every pre-existing terminal
 *      surface across all workspaces and panes — then subscribes to
 *      surface:created / :titleChanged / :closed for new/changed/closed
 *      surfaces.
 *   2. Matches PTY titles and streaming output against a pattern list
 *      (defaults + user-defined `agents.knownAgents` from settings) to
 *      decide whether the terminal is running an AI agent.
 *   3. For each detected agent, spins up a status tracker that watches
 *      output, OSC notifications, and title changes, and classifies the
 *      agent into `running` / `waiting` / `idle` / `active` / `closed`.
 *   4. Writes a per-workspace indicator via setAgentStatus and a
 *      per-surface status item via setStatusItem (source "_agent",
 *      category "process") so the sidebar + tab strip render live dots.
 *      Marks surfaces "unread" when an agent transitions to waiting.
 *   5. Emits `agent:statusChanged` on the global event bus — extensions
 *      can subscribe to react without owning the detection itself.
 *
 * The service holds two module-level singletons: `_agentsStore` (the
 * reactive registry read by widgets) and `_registry` (the mutable
 * source of truth). initAgentDetection() is idempotent — a second call
 * destroys the previous instance before starting a new one so HMR and
 * tests don't stack observers.
 */
import { writable, get, type Readable } from "svelte/store";
import { eventBus } from "./event-bus";
import { getConfig } from "../config";
import { type AgentType } from "./agent-type";
import {
  addOutputObserver,
  removeOutputObserver,
} from "./surface-output-observer";
import {
  setStatusItem,
  clearStatusItem,
  clearAllStatusForSourceAndWorkspace,
} from "./status-registry";
import { statusRegistry } from "./status-registry";
import { markSurfaceUnreadById } from "./surface-service";
import { workspaces } from "../stores/workspace";
import { getAllPanes, isTerminalSurface } from "../types";
import {
  lookupSurfaceWorkspaceId,
  lookupPtyIdForSurface,
} from "./service-helpers";

// --- Public types ---

export interface DetectedAgent {
  agentId: string;
  agentName: string;
  /** Typed classification of the agent. Populated from AgentPattern.agentType,
   *  falling back to "generic" when the matched pattern has no agentType. */
  agentType: AgentType;
  surfaceId: string;
  workspaceId: string;
  status: string;
  createdAt: string;
  lastStatusChange: string;
}

export interface AgentPattern {
  name: string;
  titlePatterns: string[];
  oscDetectable: boolean;
  /** Typed agent classification. Omit to fall back to "generic". */
  agentType?: AgentType;
}

export type TrackerMode = "osc" | "title-only";
export type HarnessStatus = "running" | "waiting" | "idle" | "active" | "done";

// --- Defaults ---

const DEFAULT_PATTERNS: AgentPattern[] = [
  {
    name: "Claude Code",
    titlePatterns: ["claude"],
    oscDetectable: true,
    agentType: "claude",
  },
  {
    name: "Codex",
    titlePatterns: ["codex"],
    oscDetectable: true,
    agentType: "codex",
  },
  {
    name: "Gemini",
    titlePatterns: ["gemini"],
    oscDetectable: false,
    agentType: "gemini",
  },
  {
    name: "Goose",
    titlePatterns: ["goose"],
    oscDetectable: false,
    agentType: "goose",
  },
  {
    name: "Aider",
    titlePatterns: ["aider"],
    oscDetectable: true,
    agentType: "aider",
  },
  {
    name: "OpenCode",
    titlePatterns: ["opencode"],
    oscDetectable: false,
    agentType: "opencode",
  },
  {
    name: "Cline",
    titlePatterns: ["cline"],
    oscDetectable: false,
    agentType: "cline",
  },
  {
    name: "Amp",
    titlePatterns: ["amp"],
    oscDetectable: false,
    agentType: "amp",
  },
  {
    name: "Cursor Agent",
    titlePatterns: ["cursor"],
    oscDetectable: false,
    agentType: "cursor-agent",
  },
  {
    name: "GitHub Copilot",
    titlePatterns: ["ghcs", "github-copilot"],
    oscDetectable: false,
    // No agentType — intentionally "generic" fallback
  },
];

const AGENT_SURFACE_ITEM_PREFIX = "surface:";
const AGENT_STATUS_SOURCE = "_agent";

// OSC notification sequences we treat as "agent waiting on user". OSC 0/2
// (title) deliberately excluded — every title ping used to pin Claude in
// "waiting" and kill the idle timer.
const NOTIFICATION_OSC_RE = /\x1b\](?:9|99|777);/;

// Alternate-screen mode toggles. TUI harnesses (Claude Code, Codex, etc.)
// enter the alt screen on launch and leave it on exit. Watching the exit
// sequence gives a reliable detach signal even when the surrounding shell
// doesn't re-emit an OSC title after the harness quits.
const ALT_SCREEN_EXIT_RE = /\x1b\[\?1049l/;
const ALT_SCREEN_ENTER_RE = /\x1b\[\?1049h/;

// --- Reactive registry ---

const _agentsStore = writable<DetectedAgent[]>([]);
export const agentsStore: Readable<DetectedAgent[]> = _agentsStore;

/** Entry stored per pane in the per-pane agent-type store. */
export interface PaneAgentEntry {
  agentType: AgentType;
  /** How confident/strong the detection signal was. */
  confidence: "argv" | "osc" | "title" | "heuristic";
  /** ISO timestamp of initial detection. */
  detectedAt: string;
}

/**
 * Reactive map of paneId → PaneAgentEntry. Additive alongside agentsStore —
 * extensions can subscribe to this for fine-grained per-pane agent information
 * without the full DetectedAgent shape. Undefined for panes with no agent.
 */
const _paneAgentTypeStore = writable<Record<string, PaneAgentEntry>>({});
export const paneAgentTypeStore: Readable<Record<string, PaneAgentEntry>> =
  _paneAgentTypeStore;

function setPaneEntry(paneId: string, entry: PaneAgentEntry): void {
  _paneAgentTypeStore.update((m) => ({ ...m, [paneId]: entry }));
}

function clearPaneEntry(paneId: string): void {
  _paneAgentTypeStore.update((m) => {
    const next = { ...m };
    delete next[paneId];
    return next;
  });
}

let _agents: DetectedAgent[] = [];
let _idCounter = 0;

function syncStore(): void {
  _agentsStore.set(_agents.slice());
}

function generateAgentId(): string {
  return `agent-${Date.now()}-${++_idCounter}`;
}

export function getAgents(): DetectedAgent[] {
  return _agents.slice();
}

export function getAgentByAgentId(agentId: string): DetectedAgent | undefined {
  return _agents.find((a) => a.agentId === agentId);
}

export function getAgentBySurfaceId(
  surfaceId: string,
): DetectedAgent | undefined {
  return _agents.find((a) => a.surfaceId === surfaceId);
}

// --- Pattern matching ---

const _patternRegexCache = new WeakMap<AgentPattern, RegExp>();

function getPatternRegex(pattern: AgentPattern): RegExp {
  let regex = _patternRegexCache.get(pattern);
  if (!regex) {
    const escaped = pattern.titlePatterns.map((p) =>
      p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    // eslint-disable-next-line security/detect-non-literal-regexp
    regex = new RegExp(escaped.join("|"), "i");
    _patternRegexCache.set(pattern, regex);
  }
  return regex;
}

function matchesPattern(
  text: string,
  patterns: AgentPattern[],
): AgentPattern | null {
  for (const pattern of patterns) {
    if (getPatternRegex(pattern).test(text)) {
      return pattern;
    }
  }
  return null;
}

function loadPatternList(): AgentPattern[] {
  const patterns = [...DEFAULT_PATTERNS];
  const config = getConfig();
  const userPatterns = config.agents?.knownAgents;
  if (Array.isArray(userPatterns)) {
    for (const p of userPatterns) {
      if (p.name && Array.isArray(p.titlePatterns)) {
        patterns.push({
          name: p.name,
          titlePatterns: p.titlePatterns,
          oscDetectable: p.oscDetectable ?? false,
        });
      }
    }
  }
  return patterns;
}

function loadIdleTimeoutMs(): number {
  const config = getConfig();
  const raw = config.agents?.idleTimeout;
  const seconds = typeof raw === "number" && raw > 0 ? raw : 30;
  return seconds * 1000;
}

// --- Status tracker ---

const RUNNING_TITLE_PATTERNS = ["thinking", "working"];
const DONE_TITLE_PATTERNS = ["ready", "done"];

// How long a non-matching title must persist before we detach the agent.
// Prevents momentary title flickers (e.g. Claude cycling through internal
// states) from clearing the workspace dot.
const TITLE_DETACH_DEBOUNCE_MS = 4_000;

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

export interface StatusTracker {
  getStatus(): HarnessStatus;
  onOutput(): void;
  onNotification(text: string): void;
  onTitleChange(title: string): void;
  destroy(): void;
}

function createStatusTracker(
  idleTimeoutMs: number,
  onStatusChange: (status: HarnessStatus) => void,
  mode: TrackerMode,
): StatusTracker {
  let status: HarnessStatus = "idle";
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(next: HarnessStatus): void {
    if (next === "waiting" || next !== status) {
      status = next;
      onStatusChange(status);
    }
  }

  function resetIdleTimer(): void {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => setStatus("idle"), idleTimeoutMs);
  }

  return {
    getStatus: () => status,
    onOutput() {
      setStatus(mode === "osc" ? "running" : "active");
      resetIdleTimer();
    },
    onNotification(_text: string) {
      if (mode !== "osc") return;
      setStatus("waiting");
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    },
    onTitleChange(title: string) {
      if (matchesAny(title, RUNNING_TITLE_PATTERNS)) {
        setStatus(mode === "osc" ? "running" : "active");
        resetIdleTimer();
      } else if (matchesAny(title, DONE_TITLE_PATTERNS)) {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        setStatus("done");
      }
    },
    destroy() {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
    },
  };
}

// --- Per-surface tracking state ---

interface TrackedSurface {
  surfaceId: string;
  /** The pane that owns this surface. Captured from surface:created/ptyReady events
   *  or looked up from the workspace store on bootstrap. Used to key paneAgentTypeStore. */
  paneId: string | null;
  ptyId: number | null;
  /** pty id the current observer is bound to; lets wireObserver detect a rewire. */
  wiredPtyId: number | null;
  agentId: string | null;
  agentPattern: AgentPattern | null;
  tracker: StatusTracker | null;
  unsubscribeOutput: (() => void) | null;
  preAgentTitle?: string;
  /** Most recent title seen for this surface — used by the workspace
   *  subscription to derive a pre-agent title when attaching after a
   *  late workspace load. */
  lastKnownTitle?: string;
  /** Pending debounced detach timer — cancelled if title re-matches before it fires. */
  detachTimer: ReturnType<typeof setTimeout> | null;
}

// --- Status publishing helpers ---

function publishStatus(
  tracked: TrackedSurface,
  workspaceId: string,
  status: string,
): void {
  if (status === "waiting" && tracked.surfaceId) {
    markSurfaceUnreadById(tracked.surfaceId);
  }

  if (workspaceId) {
    // One registry item per tracked surface. aggregateAgentBadges was
    // previously seeing two items per attached agent (a per-surface
    // entry plus a workspace-level "default" entry) because we also
    // called setAgentStatus here — the tooltip read "2 idle" for a
    // single agent. Extensions that need to set workspace-level agent
    // status continue to go through the agent-status public API.
    const itemId = `${AGENT_SURFACE_ITEM_PREFIX}${tracked.surfaceId}`;
    if (status === "closed") {
      clearStatusItem(AGENT_STATUS_SOURCE, workspaceId, itemId);
    } else {
      setStatusItem(AGENT_STATUS_SOURCE, workspaceId, itemId, {
        category: "process",
        priority: 0,
        label: status,
        variant:
          status === "running" || status === "active"
            ? "success"
            : status === "waiting"
              ? "warning"
              : status === "done"
                ? "muted"
                : "muted",
        metadata: { surfaceId: tracked.surfaceId },
      });
    }
  }

  eventBus.emit({
    type: "agent:statusChanged",
    status,
    surfaceId: tracked.surfaceId,
    workspaceId,
    agentName: tracked.agentPattern?.name ?? "",
  });
}

// --- Workspace resolution ---

function resolveWorkspaceIdForSurface(surfaceId: string): string {
  return lookupSurfaceWorkspaceId(surfaceId) ?? "";
}

function resolvePtyIdForSurface(surfaceId: string): number | null {
  const ptyId = lookupPtyIdForSurface(surfaceId);
  return ptyId !== undefined ? ptyId : null;
}

function allTerminalSurfaces(): Array<{
  id: string;
  title: string;
  workspaceId: string;
  paneId: string;
}> {
  const all = get(workspaces);
  const out: Array<{
    id: string;
    title: string;
    workspaceId: string;
    paneId: string;
  }> = [];
  for (const ws of all) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      for (const surface of pane.surfaces) {
        if (isTerminalSurface(surface)) {
          out.push({
            id: surface.id,
            title: surface.title,
            workspaceId: ws.id,
            paneId: pane.id,
          });
        }
      }
    }
  }
  return out;
}

// --- Attach / detach ---

function attachAgent(
  tracked: TrackedSurface,
  pattern: AgentPattern,
  idleTimeoutMs: number,
  preTitle?: string,
): void {
  if (preTitle !== undefined) {
    tracked.preAgentTitle = preTitle;
  }
  const agentId = generateAgentId();
  const mode: TrackerMode = pattern.oscDetectable ? "osc" : "title-only";
  const workspaceId = resolveWorkspaceIdForSurface(tracked.surfaceId);

  const tracker = createStatusTracker(
    idleTimeoutMs,
    (status) => {
      // Re-resolve at transition time so agents attached before their
      // workspace was loaded (e.g. title change during startup race) still
      // write status items once the workspace becomes known.
      const effectiveWorkspaceId =
        resolveWorkspaceIdForSurface(tracked.surfaceId) || workspaceId;
      const agent = _agents.find((a) => a.agentId === agentId);
      if (agent) {
        agent.status = status;
        agent.lastStatusChange = new Date().toISOString();
        if (effectiveWorkspaceId && !agent.workspaceId) {
          agent.workspaceId = effectiveWorkspaceId;
        }
        syncStore();
      }
      publishStatus(tracked, effectiveWorkspaceId, status);
    },
    mode,
  );

  const agentType: AgentType = pattern.agentType ?? "generic";
  const now = new Date().toISOString();
  _agents.push({
    agentId,
    agentName: pattern.name,
    agentType,
    surfaceId: tracked.surfaceId,
    workspaceId,
    status: "idle",
    createdAt: now,
    lastStatusChange: now,
  });
  syncStore();

  tracked.agentId = agentId;
  tracked.agentPattern = pattern;
  tracked.tracker = tracker;

  // Populate the per-pane store when we know the paneId.
  if (tracked.paneId) {
    const confidence: PaneAgentEntry["confidence"] = pattern.oscDetectable
      ? "osc"
      : "title";
    setPaneEntry(tracked.paneId, { agentType, confidence, detectedAt: now });
  }

  // The tracker starts at "idle" but only fires onStatusChange on
  // transitions, so publish the initial idle state explicitly. Without
  // this, a freshly-attached (or restored-at-startup) agent has no
  // status-registry item until its first output/title change, and the
  // sidebar workspace chip is missing during that window.
  publishStatus(tracked, workspaceId, "idle");
}

function detachAgent(tracked: TrackedSurface): void {
  if (!tracked.agentId) return;

  const agent = _agents.find((a) => a.agentId === tracked.agentId);
  // Re-resolve at detach time in case the surface was attached before
  // its owning workspace was known (workspaceId=""), or moved between
  // workspaces after attach — otherwise the per-surface registry item
  // would leak with no way to clear it.
  const workspaceId =
    agent?.workspaceId && agent.workspaceId !== ""
      ? agent.workspaceId
      : resolveWorkspaceIdForSurface(tracked.surfaceId);

  publishStatus(tracked, workspaceId, "closed");

  if (tracked.tracker) tracked.tracker.destroy();
  _agents = _agents.filter((a) => a.agentId !== tracked.agentId);
  syncStore();

  // Restore the surface title when the agent detaches. A user-set
  // `userDefinedTitle` always wins over the captured `preAgentTitle` —
  // if the user renamed the surface during the agent run we re-apply
  // their explicit name even if there was no preAgentTitle stamped at
  // attach time.
  const all = get(workspaces);
  let restored = false;
  for (const ws of all) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      for (const surface of pane.surfaces) {
        if (surface.id === tracked.surfaceId && isTerminalSurface(surface)) {
          if (surface.userDefinedTitle) {
            surface.title = surface.userDefinedTitle;
            restored = true;
          } else if (tracked.preAgentTitle) {
            surface.title = tracked.preAgentTitle;
            restored = true;
          }
        }
      }
    }
  }
  if (restored) {
    workspaces.update((l) => [...l]);
  }

  // Clear the per-pane store entry on detach.
  if (tracked.paneId) {
    clearPaneEntry(tracked.paneId);
  }

  tracked.agentId = null;
  tracked.agentPattern = null;
  tracked.tracker = null;
  tracked.preAgentTitle = undefined;
}

// --- Service lifecycle ---

interface ServiceHandle {
  destroy: () => void;
}

let _current: ServiceHandle | null = null;

/**
 * Start the agent detection service. Idempotent — calling again tears
 * down the previous instance first (so HMR and tests don't stack
 * observers).
 */
export function initAgentDetection(): void {
  if (_current) {
    _current.destroy();
    _current = null;
  }

  const trackedSurfaces = new Map<string, TrackedSurface>();
  const cleanups: Array<() => void> = [];
  const patterns = loadPatternList();
  const idleTimeoutMs = loadIdleTimeoutMs();

  const attachToSurface = (
    surfaceId: string,
    initialTitle: string,
    knownPaneId?: string,
  ): void => {
    if (trackedSurfaces.has(surfaceId)) return;

    const resolvedPty = resolvePtyIdForSurface(surfaceId);
    // A terminal surface emits `surface:created` with ptyId = -1 — the
    // real id is only assigned once connectPty resolves. Treat -1 as
    // "not ready yet" and defer observer wiring to surface:ptyReady.
    const tracked: TrackedSurface = {
      surfaceId,
      paneId: knownPaneId ?? null,
      ptyId: resolvedPty !== null && resolvedPty >= 0 ? resolvedPty : null,
      wiredPtyId: null,
      agentId: null,
      agentPattern: null,
      tracker: null,
      unsubscribeOutput: null,
      lastKnownTitle: initialTitle || undefined,
      detachTimer: null,
    };
    trackedSurfaces.set(surfaceId, tracked);

    const initialMatch = matchesPattern(initialTitle, patterns);
    if (initialMatch) {
      attachAgent(tracked, initialMatch, idleTimeoutMs);
    }

    if (tracked.ptyId !== null) {
      wireObserver(tracked);
    }
  };

  const wireObserver = (tracked: TrackedSurface): void => {
    if (tracked.ptyId === null) return;
    // If an observer was already wired but the pty id changed (e.g. a
    // surface:ptyReady fired twice because spawn retried), tear the old
    // one down so we don't leak an observer pointed at a stale pty.
    if (tracked.unsubscribeOutput) {
      if (tracked.wiredPtyId === tracked.ptyId) return;
      tracked.unsubscribeOutput();
      tracked.unsubscribeOutput = null;
    }
    const ptyId = tracked.ptyId;
    // OSC sequences can arrive split across chunk boundaries (e.g. `\x1b]`
    // in one chunk, `9;...` in the next). Carry the last 8 bytes of the
    // previous chunk so the regex sees a complete preamble even when split.
    let oscTailBuffer = "";
    const OSC_PREAMBLE_MAX = 8;
    const observer = (data: string) => {
      const probe = oscTailBuffer + data;
      oscTailBuffer = probe.slice(-OSC_PREAMBLE_MAX);
      try {
        if (tracked.tracker) {
          // Only real notification OSCs (9 / 99 / 777) flip the
          // tracker to "waiting". A bare `ESC ]` match is too broad —
          // every OSC 0/2 title update hit it, which pinned OSC-mode
          // agents (e.g. Claude) in "waiting" forever because
          // onNotification also clears the idle timer.
          if (
            tracked.agentPattern?.oscDetectable &&
            NOTIFICATION_OSC_RE.test(probe)
          ) {
            tracked.tracker.onNotification(data);
          } else {
            tracked.tracker.onOutput();
          }
          // OSC-detectable harnesses (Claude Code, Codex, …) live in the
          // alternate screen. The shell often doesn't re-emit an OSC title
          // after the harness quits, so the title-mismatch detach path is
          // unreliable. Watching the alt-screen exit sequence gives a
          // strong "harness ended" signal independent of the shell. Entry
          // back into the alt screen cancels a pending detach so that
          // brief mid-session escapes (e.g. a pager) don't drop the agent.
          if (tracked.agentPattern?.oscDetectable && tracked.agentId) {
            if (ALT_SCREEN_ENTER_RE.test(probe) && tracked.detachTimer) {
              clearTimeout(tracked.detachTimer);
              tracked.detachTimer = null;
            } else if (
              ALT_SCREEN_EXIT_RE.test(probe) &&
              tracked.detachTimer === null
            ) {
              tracked.detachTimer = setTimeout(() => {
                tracked.detachTimer = null;
                detachAgent(tracked);
              }, TITLE_DETACH_DEBOUNCE_MS);
            }
          }
        } else {
          // OSC-detectable agents (e.g. Claude Code) are identified by PTY
          // title changes only — matching raw output causes false positives
          // when compilation output contains the pattern string.
          const nonOscPatterns = patterns.filter((p) => !p.oscDetectable);
          const match = matchesPattern(data, nonOscPatterns);
          if (match) {
            const currentTitle =
              allTerminalSurfaces().find((s) => s.id === tracked.surfaceId)
                ?.title ?? "";
            attachAgent(tracked, match, idleTimeoutMs, currentTitle);
          }
        }
      } catch (err) {
        console.error(
          "[agent-detection] output observer error",
          tracked.surfaceId,
          err,
        );
        if (tracked.agentId) {
          try {
            detachAgent(tracked);
          } catch {
            /* already reported */
          }
        }
      }
    };
    addOutputObserver(ptyId, observer);
    tracked.wiredPtyId = ptyId;
    tracked.unsubscribeOutput = () => removeOutputObserver(ptyId, observer);
  };

  const detachFromSurface = (surfaceId: string): void => {
    const tracked = trackedSurfaces.get(surfaceId);
    if (!tracked) return;
    if (tracked.detachTimer !== null) {
      clearTimeout(tracked.detachTimer);
      tracked.detachTimer = null;
    }
    if (tracked.agentId) detachAgent(tracked);
    if (tracked.unsubscribeOutput) tracked.unsubscribeOutput();
    trackedSurfaces.delete(surfaceId);
  };

  const handleCreated = (event: {
    type: "surface:created";
    id: string;
    paneId: string;
    kind: string;
  }) => {
    if (event.kind !== "terminal") return;
    const surfaces = allTerminalSurfaces();
    const info = surfaces.find((s) => s.id === event.id);
    attachToSurface(event.id, info?.title ?? "", event.paneId);
  };
  const handleTitle = (event: {
    type: "surface:titleChanged";
    id: string;
    oldTitle: string;
    newTitle: string;
  }) => {
    const tracked = trackedSurfaces.get(event.id);
    if (!tracked) return;
    const match = matchesPattern(event.newTitle, patterns);
    if (match && !tracked.agentId) {
      if (tracked.detachTimer !== null) {
        clearTimeout(tracked.detachTimer);
        tracked.detachTimer = null;
      }
      attachAgent(tracked, match, idleTimeoutMs, event.oldTitle);
    } else if (match && tracked.agentId) {
      if (tracked.detachTimer !== null) {
        clearTimeout(tracked.detachTimer);
        tracked.detachTimer = null;
      }
      tracked.tracker?.onTitleChange(event.newTitle);
    } else if (!match && tracked.agentId) {
      // OSC-detectable agents (Claude Code, Codex, Aider) re-title to
      // the active task as they work — e.g. Claude's title becomes
      // "Strategic opportunity assessment for Vellum" with no
      // "claude" substring left. The authoritative "agent stopped"
      // signal for these is alt-screen exit; a title that no longer
      // matches just means the agent is busy. Capture the new title
      // for the running/done heuristic and stop there. Title-only
      // agents (e.g. Cursor) still detach on mismatch — title is
      // their only signal.
      if (tracked.agentPattern?.oscDetectable) {
        tracked.tracker?.onTitleChange(event.newTitle);
      } else if (tracked.detachTimer === null) {
        tracked.detachTimer = setTimeout(() => {
          tracked.detachTimer = null;
          detachAgent(tracked);
        }, TITLE_DETACH_DEBOUNCE_MS);
      }
    }
    tracked.lastKnownTitle = event.newTitle;
  };
  const handleClosed = (event: { type: "surface:closed"; id: string }) => {
    detachFromSurface(event.id);
  };
  const handleWorkspaceClosed = (event: {
    type: "workspace:closed";
    id: string;
  }) => {
    // closeWorkspace() disposes surfaces and emits workspace:closed but does
    // NOT fire surface:closed for each terminal, so handleClosed never runs
    // for those surfaces. Sweep all tracked surfaces whose agent belongs to
    // the closing workspace so they don't linger as "idle".
    const toDetach: string[] = [];
    for (const [surfaceId, tracked] of trackedSurfaces) {
      if (!tracked.agentId) continue;
      const agent = _agents.find((a) => a.agentId === tracked.agentId);
      if (agent?.workspaceId === event.id) toDetach.push(surfaceId);
    }
    for (const surfaceId of toDetach) detachFromSurface(surfaceId);
  };
  const handlePtyReady = (event: {
    type: "surface:ptyReady";
    id: string;
    ptyId: number;
  }) => {
    // surface:created fires with a placeholder ptyId = -1 (the PTY
    // isn't spawned until after the xterm is fit-sized), so the
    // observer was previously pointed at a non-existent pty id and
    // never received data. Once the real id lands, backfill it and
    // wire the observer now.
    let tracked = trackedSurfaces.get(event.id);
    if (!tracked) {
      // Missed surface:created (e.g. init raced with a restore) —
      // attach now using the current title from the workspace store
      // (may be empty if workspaces haven't loaded yet) and fall
      // through to observer wiring.
      const surfaceInfo = allTerminalSurfaces().find((s) => s.id === event.id);
      attachToSurface(event.id, surfaceInfo?.title ?? "", surfaceInfo?.paneId);
      tracked = trackedSurfaces.get(event.id);
      if (!tracked) return;
    }
    // Backfill paneId if surface:created raced and didn't know it yet.
    if (!tracked.paneId) {
      const surfaceInfo = allTerminalSurfaces().find((s) => s.id === event.id);
      if (surfaceInfo?.paneId) tracked.paneId = surfaceInfo.paneId;
    }
    tracked.ptyId = event.ptyId;
    wireObserver(tracked);
  };

  eventBus.on("surface:created", handleCreated);
  eventBus.on("surface:titleChanged", handleTitle);
  eventBus.on("surface:closed", handleClosed);
  eventBus.on("workspace:closed", handleWorkspaceClosed);
  eventBus.on("surface:ptyReady", handlePtyReady);
  cleanups.push(() => eventBus.off("surface:created", handleCreated));
  cleanups.push(() => eventBus.off("surface:titleChanged", handleTitle));
  cleanups.push(() => eventBus.off("surface:closed", handleClosed));
  cleanups.push(() => eventBus.off("workspace:closed", handleWorkspaceClosed));
  cleanups.push(() => eventBus.off("surface:ptyReady", handlePtyReady));

  // Bootstrap every pre-existing terminal surface — surface:created only
  // fires for surfaces created AFTER this listener attached, so restored
  // surfaces would otherwise be permanently untracked.
  for (const info of allTerminalSurfaces()) {
    attachToSurface(info.id, info.title, info.paneId);
  }

  // Re-detect agents when the workspace store is populated or updated.
  // Handles the startup race where surface events (surface:created,
  // surface:ptyReady) arrive before workspaces finish loading — at that
  // point allTerminalSurfaces() returned [] so surfaces were tracked
  // without agents. When workspaces load, this subscription re-checks
  // unattached surfaces against their now-known titles.
  const unsubWorkspaces = workspaces.subscribe(() => {
    // Build the surface-title and surface-paneId lookups once per emission
    // rather than calling allTerminalSurfaces() for each unattached surface
    // (O(W×P×S) vs. O(tracked × W×P×S) per emission — F12 perf fix).
    const surfaceTitleById = new Map<string, string>();
    const surfacePaneById = new Map<string, string>();
    for (const s of allTerminalSurfaces()) {
      surfaceTitleById.set(s.id, s.title);
      surfacePaneById.set(s.id, s.paneId);
    }
    for (const [, tracked] of trackedSurfaces) {
      // Backfill paneId when the workspace store becomes available.
      if (!tracked.paneId) {
        const resolvedPane = surfacePaneById.get(tracked.surfaceId);
        if (resolvedPane) tracked.paneId = resolvedPane;
      }
      if (tracked.agentId) {
        // Backfill the status item for agents attached before their workspace
        // was known — the initial publishStatus("idle") wrote nothing because
        // workspaceId was empty at that time.
        const agent = _agents.find((a) => a.agentId === tracked.agentId);
        if (agent && !agent.workspaceId) {
          const resolved = resolveWorkspaceIdForSurface(tracked.surfaceId);
          if (resolved) {
            agent.workspaceId = resolved;
            syncStore();
            publishStatus(tracked, resolved, agent.status);
          }
        }
        // Also backfill paneAgentTypeStore if paneId was resolved above.
        if (tracked.paneId && tracked.agentPattern) {
          const existing = get(_paneAgentTypeStore)[tracked.paneId];
          if (!existing) {
            const agentType: AgentType =
              tracked.agentPattern.agentType ?? "generic";
            const confidence: PaneAgentEntry["confidence"] = tracked
              .agentPattern.oscDetectable
              ? "osc"
              : "title";
            const agent2 = _agents.find((a) => a.agentId === tracked.agentId);
            setPaneEntry(tracked.paneId, {
              agentType,
              confidence,
              detectedAt: agent2?.createdAt ?? new Date().toISOString(),
            });
          }
        }
        continue;
      }
      const currentTitle = surfaceTitleById.get(tracked.surfaceId) ?? "";
      if (!currentTitle) continue;
      const match = matchesPattern(currentTitle, patterns);
      if (match) {
        // If lastKnownTitle predates the agent pattern match, use it as the
        // pre-agent title so detachAgent can restore it on exit.
        const preTitle =
          tracked.lastKnownTitle &&
          !matchesPattern(tracked.lastKnownTitle, patterns)
            ? tracked.lastKnownTitle
            : undefined;
        attachAgent(tracked, match, idleTimeoutMs, preTitle);
      }
    }
  });
  cleanups.push(unsubWorkspaces);

  _current = {
    destroy() {
      for (const tracked of trackedSurfaces.values()) {
        if (tracked.detachTimer !== null) {
          clearTimeout(tracked.detachTimer);
          tracked.detachTimer = null;
        }
        if (tracked.agentId) detachAgent(tracked);
        if (tracked.unsubscribeOutput) tracked.unsubscribeOutput();
      }
      trackedSurfaces.clear();
      for (const cleanup of cleanups) cleanup();
      cleanups.length = 0;
      // Belt-and-suspenders: detachAgent already clears per-surface
      // items via publishStatus("closed"), but if a tracker lost its
      // workspace id and the fallback re-resolve failed (surface
      // already removed from the store), nothing cleared it. Sweep any
      // remaining `_agent` items so a subsequent init starts clean.
      sweepAgentRegistry();
    },
  };
}

function sweepAgentRegistry(): void {
  const items = get(statusRegistry.store);
  for (const item of items) {
    if (item.source === AGENT_STATUS_SOURCE) {
      clearAllStatusForSourceAndWorkspace(
        AGENT_STATUS_SOURCE,
        item.workspaceId,
      );
    }
  }
}

/** Stop the service. Tears down observers and clears the registry. */
export function destroyAgentDetection(): void {
  if (_current) {
    _current.destroy();
    _current = null;
  } else {
    // Still sweep — destroyAgentDetection is called from test hooks and
    // during app shutdown with no live _current. Ensures the registry
    // is clean even if the service wasn't active.
    sweepAgentRegistry();
  }
  _agents = [];
  syncStore();
  _paneAgentTypeStore.set({});
}

/** For tests only — reset module-level state between cases. */
export function resetAgentDetectionForTests(): void {
  destroyAgentDetection();
  _idCounter = 0;
}
