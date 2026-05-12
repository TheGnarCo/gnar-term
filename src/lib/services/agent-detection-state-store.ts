/**
 * agent-detection-state-store — per-pane reactive stores.
 *
 * Two parallel maps keyed by paneId:
 *   - `paneAgentTypeStore`  → typed AgentType + detection confidence
 *   - `paneAgentStateStore` → AgentState machine (running / waiting / …)
 *
 * Both are populated by the publish + controller slices and consumed by
 * the agentic extension, attention API, and branch-lifecycle service.
 *
 * `dispatchPaneAgentStateEvent` is the single public driver for the
 * state machine — argv classifier, MCP handler, and tests all funnel
 * through it. Other helpers (`setPaneAgentEntry`, `applyPaneStateEvent`,
 * etc.) are exported for the agent-detection-* slice family only.
 */
import { writable, get, type Readable } from "svelte/store";
import type { AgentType } from "./agent-type";
import {
  transitionAgentState,
  type AgentState,
  type AgentStateEvent,
} from "./agent-state";
import type { OscNotification } from "./osc-notification-service";

/** Entry stored per pane in the per-pane agent-type store. */
export interface PaneAgentEntry {
  agentType: AgentType;
  /** How confident/strong the detection signal was. */
  confidence: "argv" | "osc" | "title" | "heuristic";
  /** ISO timestamp of initial detection. */
  detectedAt: string;
}

const _paneAgentTypeStore = writable<Record<string, PaneAgentEntry>>({});
/**
 * Reactive map of paneId → PaneAgentEntry. Additive alongside agentsStore —
 * extensions can subscribe to this for fine-grained per-pane agent information
 * without the full DetectedAgent shape. Undefined for panes with no agent.
 */
export const paneAgentTypeStore: Readable<Record<string, PaneAgentEntry>> =
  _paneAgentTypeStore;

/** Entry stored per pane in the per-pane agent-state store. */
export interface PaneAgentStateEntry {
  state: AgentState;
  /** ISO timestamp of the most recent state transition. */
  transitionedAt: string;
  /** The event that caused the most recent transition, if any. */
  lastEvent?: AgentStateEvent;
}

const _paneAgentStateStore = writable<Map<string, PaneAgentStateEntry>>(
  new Map(),
);
/**
 * Reactive Map of paneId → PaneAgentStateEntry.
 * Consumed by the Attention API and any extension that wants
 * fine-grained agent lifecycle state per pane.
 *
 * Design: Map (not Record) so consumers can use .size / .has / .get without
 * dealing with Object.prototype pollution.
 */
export const paneAgentStateStore: Readable<Map<string, PaneAgentStateEntry>> =
  _paneAgentStateStore;

export function setPaneAgentEntry(paneId: string, entry: PaneAgentEntry): void {
  _paneAgentTypeStore.update((m) => ({ ...m, [paneId]: entry }));
}

export function clearPaneAgentEntry(paneId: string): void {
  _paneAgentTypeStore.update((m) => {
    const next = { ...m };
    delete next[paneId];
    return next;
  });
}

export function hasPaneAgentEntry(paneId: string): boolean {
  return paneId in get(_paneAgentTypeStore);
}

export function getPaneAgentEntry(paneId: string): PaneAgentEntry | undefined {
  return get(_paneAgentTypeStore)[paneId];
}

export function setPaneStateEntry(
  paneId: string,
  entry: PaneAgentStateEntry,
): void {
  _paneAgentStateStore.update((m) => {
    const next = new Map(m);
    next.set(paneId, entry);
    return next;
  });
}

export function deletePaneStateEntry(paneId: string): void {
  _paneAgentStateStore.update((m) => {
    const next = new Map(m);
    next.delete(paneId);
    return next;
  });
}

/**
 * Apply a typed state-machine event to the per-pane state store.
 * Always updates the entry (even when the resulting state is unchanged)
 * so `transitionedAt` and `lastEvent` reflect the most recent signal.
 */
export function applyPaneStateEvent(
  paneId: string,
  event: AgentStateEvent,
): void {
  const current = get(_paneAgentStateStore).get(paneId);
  const currentState: AgentState = current?.state ?? "unknown";
  const nextState = transitionAgentState(currentState, event);
  setPaneStateEntry(paneId, {
    state: nextState,
    transitionedAt: new Date().toISOString(),
    lastEvent: event,
  });
}

/**
 * Dispatch a typed AgentStateEvent into the per-pane state machine.
 * No-op if paneId is not tracked.
 * Exported for callers (argv classifier, MCP event handler, tests) that
 * need to drive transitions from outside the OSC subscription path.
 */
export function dispatchPaneAgentStateEvent(
  paneId: string,
  event: AgentStateEvent,
): void {
  applyPaneStateEvent(paneId, event);
}

/** Seed an "unknown" entry for a pane when nothing is recorded yet. */
export function initPaneStateIfAbsent(paneId: string): void {
  if (!get(_paneAgentStateStore).has(paneId)) {
    setPaneStateEntry(paneId, {
      state: "unknown",
      transitionedAt: new Date().toISOString(),
    });
  }
}

/** Map OSC notification kinds to AgentStateEvent kinds. */
export function oscKindToStateEvent(
  kind: OscNotification["kind"],
): AgentStateEvent {
  switch (kind) {
    case "notify":
      return { kind: "osc_notify" };
    case "progress":
      return { kind: "osc_progress" };
    case "complete":
      return { kind: "osc_complete" };
    case "error":
      return { kind: "osc_error" };
  }
}

/** Clear both pane-state stores. Used by destroyAgentDetection. */
export function resetPaneStores(): void {
  _paneAgentTypeStore.set({});
  _paneAgentStateStore.set(new Map());
}
