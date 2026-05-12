/**
 * Attention API — cycle-5.
 *
 * Exposes a reactive store of attention events derived from two canonical
 * sources:
 *   1. `paneAgentStateStore` (cycle-4) — emits events when a pane's
 *      AgentState transitions to `awaiting_input` or `errored`.
 *   2. `oscNotificationStore` (cycle-2) — emits events for every OSC
 *      notification matching an attention-worthy kind.
 *
 * Per-pane LRU cap: 50 events per pane, newest first. Total cap: 500.
 *
 * Public API:
 *   - attentionStore     — Readable<AttentionEvent[]>
 *   - dismissAttention   — clears all events for a given paneId
 *   - pushExternalAttention — allows cycle-7 (MCP) to push external events
 *   - initAttentionApi   — subscribes to upstream stores (lazy)
 *   - destroyAttentionApi — tears down subscriptions and clears the store
 *   - resetAttentionApiForTests — test hook
 *   - _testHelpers       — test-only injection helpers
 */

import { writable, type Readable } from "svelte/store";
import type { AgentType } from "./agent-type";
import {
  paneAgentStateStore,
  type PaneAgentStateEntry,
} from "./agent-detection-service";
import {
  oscNotificationStore,
  type OscNotification,
} from "./osc-notification-service";
import { eventBus } from "./event-bus";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AttentionEventKind =
  | "awaiting_input"
  | "errored"
  | "completed"
  | "notify"
  | "progress";

export type AttentionEventSource = "agent-state" | "osc" | "external";

export interface AttentionEvent {
  paneId: string;
  surfaceId?: string;
  agentType?: AgentType;
  kind: AttentionEventKind;
  title?: string;
  body?: string;
  level?: string;
  source: AttentionEventSource;
  createdAt: number; // Date.now()
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PER_PANE_CAP = 50;
const TOTAL_CAP = 500;

/**
 * AgentState values that should produce attention events.
 * Only state transitions INTO these states are interesting.
 */
const ATTENTION_STATES = new Set<string>(["awaiting_input", "errored"]);

// ---------------------------------------------------------------------------
// Internal store
// ---------------------------------------------------------------------------

const _store = writable<AttentionEvent[]>([]);

export const attentionStore: Readable<AttentionEvent[]> = {
  subscribe: _store.subscribe,
};

// ---------------------------------------------------------------------------
// Internal mutation helpers
// ---------------------------------------------------------------------------

function appendEvent(event: AttentionEvent): void {
  _store.update((current) => {
    // Count existing events for this pane
    const paneEvents = current.filter((e) => e.paneId === event.paneId);

    let next: AttentionEvent[];

    if (paneEvents.length >= PER_PANE_CAP) {
      // Drop oldest events for this pane to make room (LRU: oldest = last in newest-first)
      // Since we store newest first, we need to drop from the END for this pane
      let paneCount = 0;
      const filtered = current.filter((e) => {
        if (e.paneId !== event.paneId) return true;
        paneCount++;
        // Keep only PER_PANE_CAP - 1 (we'll add 1 new one)
        return paneCount < PER_PANE_CAP;
      });
      next = [event, ...filtered];
    } else {
      next = [event, ...current];
    }

    // Apply total cap
    if (next.length > TOTAL_CAP) {
      next = next.slice(0, TOTAL_CAP);
    }

    return next;
  });

  // Mirror the appended event onto the event bus so extensions / chrome can
  // subscribe to transitions without diffing the store themselves. The store
  // remains the source of truth — this is a fan-out, not a parallel buffer.
  eventBus.emit({
    type: "attention:event",
    paneId: event.paneId,
    ...(event.surfaceId !== undefined && { surfaceId: event.surfaceId }),
    ...(event.agentType !== undefined && { agentType: event.agentType }),
    kind: event.kind,
    ...(event.title !== undefined && { title: event.title }),
    ...(event.body !== undefined && { body: event.body }),
    ...(event.level !== undefined && { level: event.level }),
    source: event.source,
    createdAt: event.createdAt,
  });
}

// ---------------------------------------------------------------------------
// Public mutations
// ---------------------------------------------------------------------------

/** Remove all attention events for the given pane. */
export function dismissAttention(paneId: string): void {
  _store.update((current) => current.filter((e) => e.paneId !== paneId));
}

/**
 * Push an externally-sourced attention event (cycle-7 dependency).
 * `source` defaults to "external".
 * `createdAt` is always overwritten with the current timestamp.
 */
export function pushExternalAttention(
  event: Omit<AttentionEvent, "createdAt" | "source"> & {
    source?: "external";
  },
): void {
  appendEvent({
    ...event,
    source: "external",
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// State-change detection helpers
// ---------------------------------------------------------------------------

function oscKindToAttentionKind(
  kind: OscNotification["kind"],
): AttentionEventKind {
  switch (kind) {
    case "notify":
      return "notify";
    case "error":
      return "errored";
    case "progress":
      return "progress";
    case "complete":
      return "completed";
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let _unsubState: (() => void) | null = null;
let _unsubOsc: (() => void) | null = null;

/** Previously-seen AgentState per pane — used to detect transitions. */
let _lastSeenState: Map<string, string> = new Map();
/** Previously-seen OSC notification count — used to detect new notifications. */
let _lastOscLen = 0;

export function initAttentionApi(): void {
  // Idempotent: tear down previous subscriptions before re-subscribing.
  destroyAttentionApi();

  // Subscribe to paneAgentStateStore to detect state transitions.
  _unsubState = paneAgentStateStore.subscribe(
    (stateMap: Map<string, PaneAgentStateEntry>) => {
      for (const [paneId, entry] of stateMap) {
        const prev = _lastSeenState.get(paneId);
        const next = entry.state;

        // Only emit when transitioning INTO an attention-worthy state.
        if (ATTENTION_STATES.has(next) && prev !== next) {
          appendEvent({
            paneId,
            kind: next as AttentionEventKind,
            source: "agent-state",
            createdAt: Date.now(),
          });
        }

        _lastSeenState.set(paneId, next);
      }
    },
  );

  // Subscribe to oscNotificationStore for incremental new notifications.
  _unsubOsc = oscNotificationStore.subscribe((notifications) => {
    if (notifications.length < _lastOscLen) {
      // Store was reset (tests) — reprocess all.
      _lastOscLen = 0;
    }
    for (let i = _lastOscLen; i < notifications.length; i++) {
      const n = notifications[i];
      if (!n) continue;
      appendEvent({
        paneId: n.paneId,
        kind: oscKindToAttentionKind(n.kind),
        title: n.title,
        body: n.body,
        level: n.level,
        source: "osc",
        createdAt: Date.now(),
      });
    }
    _lastOscLen = notifications.length;
  });
}

export function destroyAttentionApi(): void {
  if (_unsubState) {
    _unsubState();
    _unsubState = null;
  }
  if (_unsubOsc) {
    _unsubOsc();
    _unsubOsc = null;
  }
  _store.set([]);
  _lastSeenState = new Map();
  _lastOscLen = 0;
}

/** Test hook — resets all module-level state. */
export function resetAttentionApiForTests(): void {
  destroyAttentionApi();
}

// ---------------------------------------------------------------------------
// Test helpers — test-only injection surface
// ---------------------------------------------------------------------------

/**
 * Test-only helpers for simulating upstream store events without
 * depending on the full agent-detection-service or osc-notification-service
 * wiring.
 *
 * These bypass the normal subscription paths and call the internal
 * `appendEvent` function directly, which means they work even when
 * `initAttentionApi` has been called (subscriptions active) without
 * creating duplicate events.
 */
export const _testHelpers = {
  /**
   * Simulate a paneAgentStateStore entry appearing with the given state.
   * Only emits an event if the state is attention-worthy (awaiting_input,
   * errored) and differs from the last seen state for this pane.
   */
  simulateStateEntry(paneId: string, state: string): void {
    const prev = _lastSeenState.get(paneId);
    if (ATTENTION_STATES.has(state) && prev !== state) {
      appendEvent({
        paneId,
        kind: state as AttentionEventKind,
        source: "agent-state",
        createdAt: Date.now(),
      });
    }
    _lastSeenState.set(paneId, state);
  },

  /**
   * Simulate an OSC notification arriving for a pane.
   */
  simulateOscNotification(
    notification: Pick<
      OscNotification,
      "paneId" | "kind" | "title" | "body" | "level"
    >,
  ): void {
    appendEvent({
      paneId: notification.paneId,
      kind: oscKindToAttentionKind(notification.kind),
      title: notification.title,
      body: notification.body,
      level: notification.level,
      source: "osc",
      createdAt: Date.now(),
    });
  },
};
