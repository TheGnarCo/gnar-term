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

// --- Public types ---

export interface DetectedAgent {
  agentId: string;
  agentName: string;
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
}

export type TrackerMode = "osc" | "title-only";
export type HarnessStatus = "running" | "waiting" | "idle" | "active";

// --- Defaults ---

const DEFAULT_PATTERNS: AgentPattern[] = [
  { name: "Claude Code", titlePatterns: ["claude"], oscDetectable: true },
  { name: "Codex", titlePatterns: ["codex"], oscDetectable: false },
  { name: "Aider", titlePatterns: ["aider"], oscDetectable: false },
  { name: "Cursor", titlePatterns: ["cursor"], oscDetectable: false },
  {
    name: "GitHub Copilot",
    titlePatterns: ["ghcs", "github-copilot"],
    oscDetectable: false,
  },
];

const AGENT_SURFACE_ITEM_PREFIX = "surface:";
const AGENT_STATUS_SOURCE = "_agent";

// OSC notification sequences we treat as "agent waiting on user". OSC 0/2
// (title) deliberately excluded — every title ping used to pin Claude in
// "waiting" and kill the idle timer.
const NOTIFICATION_OSC_RE = /\x1b\](?:9|99|777);/;

// --- Reactive registry ---

const _agentsStore = writable<DetectedAgent[]>([]);
export const agentsStore: Readable<DetectedAgent[]> = _agentsStore;

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

// --- Pattern matching ---

const _patternRegexCache = new WeakMap<AgentPattern, RegExp>();

function getPatternRegex(pattern: AgentPattern): RegExp {
  let regex = _patternRegexCache.get(pattern);
  if (!regex) {
    const escaped = pattern.titlePatterns.map((p) =>
      p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
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
const IDLE_TITLE_PATTERNS = ["ready", "done"];

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
    if (next !== status) {
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
      } else if (matchesAny(title, IDLE_TITLE_PATTERNS)) {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
        setStatus("idle");
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
  ptyId: number | null;
  /** pty id the current observer is bound to; lets wireObserver detect a rewire. */
  wiredPtyId: number | null;
  agentId: string | null;
  agentPattern: AgentPattern | null;
  tracker: StatusTracker | null;
  unsubscribeOutput: (() => void) | null;
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
          status === "running"
            ? "success"
            : status === "waiting"
              ? "warning"
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
  const all = get(workspaces);
  for (const ws of all) {
    for (const pane of getAllPanes(ws.splitRoot)) {
      for (const surface of pane.surfaces) {
        if (surface.id === surfaceId) return ws.id;
      }
    }
  }
  return "";
}

function resolvePtyIdForSurface(surfaceId: string): number | null {
  const all = get(workspaces);
  for (const ws of all) {
    for (const pane of getAllPanes(ws.splitRoot)) {
      for (const surface of pane.surfaces) {
        if (surface.id === surfaceId && isTerminalSurface(surface)) {
          return surface.ptyId ?? null;
        }
      }
    }
  }
  return null;
}

function allTerminalSurfaces(): Array<{
  id: string;
  title: string;
  workspaceId: string;
}> {
  const all = get(workspaces);
  const out: Array<{ id: string; title: string; workspaceId: string }> = [];
  for (const ws of all) {
    for (const pane of getAllPanes(ws.splitRoot)) {
      for (const surface of pane.surfaces) {
        if (isTerminalSurface(surface)) {
          out.push({
            id: surface.id,
            title: surface.title,
            workspaceId: ws.id,
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
): void {
  const agentId = generateAgentId();
  const mode: TrackerMode = pattern.oscDetectable ? "osc" : "title-only";
  const workspaceId = resolveWorkspaceIdForSurface(tracked.surfaceId);

  const tracker = createStatusTracker(
    idleTimeoutMs,
    (status) => {
      const agent = _agents.find((a) => a.agentId === agentId);
      if (agent) {
        agent.status = status;
        agent.lastStatusChange = new Date().toISOString();
        syncStore();
      }
      publishStatus(tracked, workspaceId, status);
    },
    mode,
  );

  const now = new Date().toISOString();
  _agents.push({
    agentId,
    agentName: pattern.name,
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

  tracked.agentId = null;
  tracked.agentPattern = null;
  tracked.tracker = null;
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

  const attachToSurface = (surfaceId: string, initialTitle: string): void => {
    if (trackedSurfaces.has(surfaceId)) return;

    const resolvedPty = resolvePtyIdForSurface(surfaceId);
    // A terminal surface emits `surface:created` with ptyId = -1 — the
    // real id is only assigned once connectPty resolves. Treat -1 as
    // "not ready yet" and defer observer wiring to surface:ptyReady.
    const tracked: TrackedSurface = {
      surfaceId,
      ptyId: resolvedPty !== null && resolvedPty >= 0 ? resolvedPty : null,
      wiredPtyId: null,
      agentId: null,
      agentPattern: null,
      tracker: null,
      unsubscribeOutput: null,
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
    const observer = (data: string) => {
      try {
        if (tracked.tracker) {
          // Only real notification OSCs (9 / 99 / 777) flip the
          // tracker to "waiting". A bare `ESC ]` match is too broad —
          // every OSC 0/2 title update hit it, which pinned OSC-mode
          // agents (e.g. Claude) in "waiting" forever because
          // onNotification also clears the idle timer.
          if (
            tracked.agentPattern?.oscDetectable &&
            NOTIFICATION_OSC_RE.test(data)
          ) {
            tracked.tracker.onNotification(data);
          } else {
            tracked.tracker.onOutput();
          }
        } else {
          // OSC-detectable agents (e.g. Claude Code) are identified by PTY
          // title changes only — matching raw output causes false positives
          // when compilation output contains the pattern string.
          const nonOscPatterns = patterns.filter((p) => !p.oscDetectable);
          const match = matchesPattern(data, nonOscPatterns);
          if (match) attachAgent(tracked, match, idleTimeoutMs);
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
    attachToSurface(event.id, info?.title ?? "");
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
      attachAgent(tracked, match, idleTimeoutMs);
    } else if (match && tracked.agentId) {
      tracked.tracker?.onTitleChange(event.newTitle);
    } else if (!match && tracked.agentId) {
      detachAgent(tracked);
    }
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
      // attach now with an empty title and fall through to observer
      // wiring.
      attachToSurface(event.id, "");
      tracked = trackedSurfaces.get(event.id);
      if (!tracked) return;
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
    attachToSurface(info.id, info.title);
  }

  _current = {
    destroy() {
      for (const tracked of trackedSurfaces.values()) {
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
}

/** For tests only — reset module-level state between cases. */
export function resetAgentDetectionForTests(): void {
  destroyAgentDetection();
  _idCounter = 0;
}
