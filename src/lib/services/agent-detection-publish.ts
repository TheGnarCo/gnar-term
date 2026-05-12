/**
 * agent-detection-publish — attach / detach / publish per agent.
 *
 * Owns the in-memory per-tracker StatusTracker state machine, the
 * `attachAgent` / `detachAgent` lifecycle, and the bridge from those
 * lifecycle events out to:
 *   - the agent registry (`_registry`)
 *   - the pane-state stores (`setPaneAgentEntry` / `clearPaneAgentEntry`)
 *   - the status-registry (`setStatusItem` / `clearStatusItem`)
 *   - the event bus (`agent:statusChanged`)
 *   - the surface-service unread flag (`markSurfaceUnreadById`)
 *
 * No event subscriptions live here — the controller slice wires the
 * event bus and OSC store and calls into `attachAgent` / `detachAgent`
 * with the right `TrackedSurface`.
 */
import { get } from "svelte/store";
import { eventBus } from "./event-bus";
import {
  setStatusItem,
  clearStatusItem,
  clearAllStatusForSourceAndWorkspace,
  statusRegistry,
} from "./status-registry";
import { markSurfaceUnreadById } from "./surface-service";
import { workspaces } from "../stores/workspace";
import { getAllPanes, isTerminalSurface } from "../types";
import type { AgentType } from "./agent-type";
import { _registry } from "./agent-detection-registry";
import {
  setPaneAgentEntry,
  clearPaneAgentEntry,
  type PaneAgentEntry,
} from "./agent-detection-state-store";
import {
  type AgentPattern,
  resolveWorkspaceIdForSurface,
} from "./agent-detection-patterns";

export type TrackerMode = "osc" | "title-only";
export type HarnessStatus = "running" | "waiting" | "idle" | "active" | "done";

export const AGENT_SURFACE_ITEM_PREFIX = "surface:";
export const AGENT_STATUS_SOURCE = "_agent";

// Alternate-screen mode toggles. TUI harnesses (Claude Code, Codex, etc.)
// enter the alt screen on launch and leave it on exit. Watching the exit
// sequence gives a reliable detach signal even when the surrounding shell
// doesn't re-emit an OSC title after the harness quits.
export const ALT_SCREEN_EXIT_RE = /\x1b\[\?1049l/;
export const ALT_SCREEN_ENTER_RE = /\x1b\[\?1049h/;

// How long a non-matching title must persist before we detach the agent.
// Prevents momentary title flickers (e.g. Claude cycling through internal
// states) from clearing the workspace dot.
export const TITLE_DETACH_DEBOUNCE_MS = 4_000;

const RUNNING_TITLE_PATTERNS = ["thinking", "working"];
const DONE_TITLE_PATTERNS = ["ready", "done"];

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

export function createStatusTracker(
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

/**
 * Per-surface tracking state owned by the controller. Lives here because
 * `attachAgent` / `detachAgent` mutate the same fields, and centralising
 * the shape avoids a duplicate definition in the controller.
 */
export interface TrackedSurface {
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

/**
 * Push a status update for `tracked` into the per-surface status registry
 * item, mark the surface unread when the agent enters "waiting", and
 * broadcast `agent:statusChanged` on the global event bus.
 */
export function publishStatus(
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

export function attachAgent(
  tracked: TrackedSurface,
  pattern: AgentPattern,
  idleTimeoutMs: number,
  preTitle?: string,
): void {
  if (preTitle !== undefined) {
    tracked.preAgentTitle = preTitle;
  }
  const agentId = _registry.generateAgentId();
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
      _registry.mutate(agentId, (agent) => {
        agent.status = status;
        agent.lastStatusChange = new Date().toISOString();
        if (effectiveWorkspaceId && !agent.workspaceId) {
          agent.workspaceId = effectiveWorkspaceId;
        }
      });
      publishStatus(tracked, effectiveWorkspaceId, status);
    },
    mode,
  );

  const agentType: AgentType = pattern.agentType ?? "generic";
  const now = new Date().toISOString();
  _registry.push({
    agentId,
    agentName: pattern.name,
    agentType,
    surfaceId: tracked.surfaceId,
    paneId: tracked.paneId ?? null,
    workspaceId,
    status: "idle",
    createdAt: now,
    lastStatusChange: now,
  });

  tracked.agentId = agentId;
  tracked.agentPattern = pattern;
  tracked.tracker = tracker;

  // Populate the per-pane store when we know the paneId.
  if (tracked.paneId) {
    const confidence: PaneAgentEntry["confidence"] = pattern.oscDetectable
      ? "osc"
      : "title";
    setPaneAgentEntry(tracked.paneId, {
      agentType,
      confidence,
      detectedAt: now,
    });
  }

  // The tracker starts at "idle" but only fires onStatusChange on
  // transitions, so publish the initial idle state explicitly. Without
  // this, a freshly-attached (or restored-at-startup) agent has no
  // status-registry item until its first output/title change, and the
  // sidebar workspace chip is missing during that window.
  publishStatus(tracked, workspaceId, "idle");
}

export function detachAgent(tracked: TrackedSurface): void {
  if (!tracked.agentId) return;

  const agent = _registry.find(tracked.agentId);
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
  _registry.removeByAgentId(tracked.agentId);

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
    clearPaneAgentEntry(tracked.paneId);
  }

  tracked.agentId = null;
  tracked.agentPattern = null;
  tracked.tracker = null;
  tracked.preAgentTitle = undefined;
}

/**
 * Belt-and-suspenders sweep — detachAgent already clears per-surface
 * items via publishStatus("closed"), but if a tracker lost its
 * workspace id and the fallback re-resolve failed (surface already
 * removed from the store), nothing cleared it. Sweep any remaining
 * `_agent` items so a subsequent init starts clean.
 */
export function sweepAgentRegistry(): void {
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
