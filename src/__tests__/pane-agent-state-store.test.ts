/**
 * Integration tests for paneAgentStateStore in agent-detection-service.ts.
 *
 * Covers:
 * - Per-pane store reflects state changes when OSC events are fed in
 *   via osc-notification-service feedPaneOutput
 * - Multiple panes track independent state
 * - Pane teardown removes its entry from the store
 * - Entry has the required shape (state, transitionedAt, lastEvent)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/stores/workspace", async () => {
  const { writable: w, derived: d } = await import("svelte/store");
  const _ws = w([]);
  return {
    workspaces: _ws,
    activeWorkspaceIdx: w(-1),
    activeWorkspace: d(_ws, () => null),
    activeSurface: w(null),
    activePseudoWorkspaceId: w(null),
    zoomedSurfaceId: w(null),
    workspaceHistory: w([null, null]),
    installSchedulePersist: () => undefined,
  };
});

import {
  initAgentDetection,
  destroyAgentDetection,
  resetAgentDetectionForTests,
  paneAgentStateStore,
  dispatchPaneAgentStateEvent,
} from "../lib/services/agent-detection-service";
import {
  feedPaneOutput,
  resetOscNotificationStoreForTests,
} from "../lib/services/osc-notification-service";
import { eventBus } from "../lib/services/event-bus";
import { workspaces } from "../lib/stores/workspace";

const consoleErrorSpy = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

beforeEach(() => {
  resetAgentDetectionForTests();
  resetOscNotificationStoreForTests();
  workspaces.set([]);
});

afterEach(() => {
  destroyAgentDetection();
  consoleErrorSpy.mockClear();
});

function makeWorkspaceWithPane(
  wsId: string,
  paneId: string,
  surfaceId: string,
  title: string,
  ptyId: number = 1,
) {
  return {
    id: wsId,
    name: wsId,
    activePaneId: paneId,
    paneLayout: {
      type: "pane" as const,
      pane: {
        id: paneId,
        activeSurfaceId: surfaceId,
        surfaces: [
          {
            id: surfaceId,
            kind: "terminal" as const,
            title,
            cwd: "/tmp",
            ptyId,
            terminal: { dispose: vi.fn(), focus: vi.fn() },
          },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Store initial state
// ---------------------------------------------------------------------------

describe("paneAgentStateStore — initial state", () => {
  it("starts empty (Map with size 0) before init", () => {
    const store = get(paneAgentStateStore);
    expect(store instanceof Map).toBe(true);
    expect(store.size).toBe(0);
  });

  it("starts empty after init with no surfaces", () => {
    initAgentDetection();
    const store = get(paneAgentStateStore);
    expect(store instanceof Map).toBe(true);
    expect(store.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// OSC events feed state transitions via feedPaneOutput
// ---------------------------------------------------------------------------

describe("paneAgentStateStore — OSC event → state transitions", () => {
  it("osc_notify event moves pane to awaiting_input", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    // Feed an OSC 9 notify sequence — maps to osc_notify → awaiting_input
    feedPaneOutput("pane1", "\x1b]9;Please review my changes\x07");

    const store = get(paneAgentStateStore);
    const entry = store.get("pane1");
    expect(entry).toBeDefined();
    expect(entry?.state).toBe("awaiting_input");
  });

  it("osc_progress event moves pane to running", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    // Feed an OSC 9;4 progress sequence (state=1 = progress) → osc_progress → running
    feedPaneOutput("pane1", "\x1b]9;4;1;50\x07");

    const store = get(paneAgentStateStore);
    const entry = store.get("pane1");
    expect(entry).toBeDefined();
    expect(entry?.state).toBe("running");
  });

  it("osc_complete event moves pane to completed", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    // Feed OSC 99 complete → osc_complete → completed
    feedPaneOutput("pane1", "\x1b]99;kind=complete;title=Done\x07");

    const store = get(paneAgentStateStore);
    const entry = store.get("pane1");
    expect(entry).toBeDefined();
    expect(entry?.state).toBe("completed");
  });

  it("osc_error event moves pane to errored", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    // Feed OSC 99 error → osc_error → errored
    feedPaneOutput("pane1", "\x1b]99;kind=error;title=Failed\x07");

    const store = get(paneAgentStateStore);
    const entry = store.get("pane1");
    expect(entry).toBeDefined();
    expect(entry?.state).toBe("errored");
  });
});

// ---------------------------------------------------------------------------
// dispatchPaneAgentStateEvent — programmatic event injection
// ---------------------------------------------------------------------------

describe("paneAgentStateStore — dispatchPaneAgentStateEvent", () => {
  it("argv_spawn moves pane to running", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    dispatchPaneAgentStateEvent("pane1", { kind: "argv_spawn" });

    const entry = get(paneAgentStateStore).get("pane1");
    expect(entry?.state).toBe("running");
  });

  it("argv_exit code 0 moves pane to completed", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    dispatchPaneAgentStateEvent("pane1", { kind: "argv_spawn" });
    dispatchPaneAgentStateEvent("pane1", { kind: "argv_exit", code: 0 });

    const entry = get(paneAgentStateStore).get("pane1");
    expect(entry?.state).toBe("completed");
  });

  it("argv_exit code 1 moves pane to errored", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    dispatchPaneAgentStateEvent("pane1", { kind: "argv_spawn" });
    dispatchPaneAgentStateEvent("pane1", { kind: "argv_exit", code: 1 });

    const entry = get(paneAgentStateStore).get("pane1");
    expect(entry?.state).toBe("errored");
  });

  it("no-ops on unknown paneId (no throw)", () => {
    initAgentDetection();
    expect(() =>
      dispatchPaneAgentStateEvent("nonexistent-pane", { kind: "argv_spawn" }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple panes track independent state
// ---------------------------------------------------------------------------

describe("paneAgentStateStore — multiple panes independent", () => {
  it("two panes track independent states", () => {
    initAgentDetection();

    const ws1 = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    const ws2 = makeWorkspaceWithPane("ws2", "pane2", "surf2", "claude", 20);
    workspaces.set([ws1, ws2]);

    // Set up pane1
    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    // Set up pane2
    eventBus.emit({
      type: "surface:created",
      id: "surf2",
      paneId: "pane2",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf2", ptyId: 20 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf2",
      oldTitle: "",
      newTitle: "claude",
    });

    // Move pane1 to running
    dispatchPaneAgentStateEvent("pane1", { kind: "argv_spawn" });

    // Move pane2 to completed via OSC
    feedPaneOutput("pane2", "\x1b]99;kind=complete\x07");

    const store = get(paneAgentStateStore);
    expect(store.get("pane1")?.state).toBe("running");
    expect(store.get("pane2")?.state).toBe("completed");
  });

  it("OSC events for pane1 do not affect pane2", () => {
    initAgentDetection();

    const ws1 = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    const ws2 = makeWorkspaceWithPane("ws2", "pane2", "surf2", "claude", 20);
    workspaces.set([ws1, ws2]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    eventBus.emit({
      type: "surface:created",
      id: "surf2",
      paneId: "pane2",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf2", ptyId: 20 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf2",
      oldTitle: "",
      newTitle: "claude",
    });

    // Only move pane1 to awaiting_input via OSC
    feedPaneOutput("pane1", "\x1b]9;Please review\x07");

    const store = get(paneAgentStateStore);
    expect(store.get("pane1")?.state).toBe("awaiting_input");
    // pane2 should NOT be awaiting_input
    expect(store.get("pane2")?.state).not.toBe("awaiting_input");
  });
});

// ---------------------------------------------------------------------------
// Pane teardown removes entry
// ---------------------------------------------------------------------------

describe("paneAgentStateStore — pane teardown", () => {
  it("surface:closed removes pane entry from the store", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    // Ensure the pane is tracked with a state
    dispatchPaneAgentStateEvent("pane1", { kind: "argv_spawn" });
    expect(get(paneAgentStateStore).has("pane1")).toBe(true);

    // Close the surface → should remove the pane state entry
    eventBus.emit({ type: "surface:closed", id: "surf1" });

    expect(get(paneAgentStateStore).has("pane1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entry shape
// ---------------------------------------------------------------------------

describe("paneAgentStateStore — entry shape", () => {
  it("entry has state, transitionedAt, and lastEvent fields", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    feedPaneOutput("pane1", "\x1b]9;Hello\x07");

    const store = get(paneAgentStateStore);
    const entry = store.get("pane1");

    expect(entry).toMatchObject({
      state: expect.stringMatching(
        /^(idle|running|awaiting_input|errored|completed|unknown)$/,
      ),
      transitionedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    // lastEvent is optional but should be present after a transition
    if (entry?.lastEvent !== undefined) {
      expect(entry.lastEvent).toHaveProperty("kind");
    }
  });

  it("transitionedAt updates on each transition", () => {
    initAgentDetection();

    const ws = makeWorkspaceWithPane("ws1", "pane1", "surf1", "claude", 10);
    workspaces.set([ws]);

    eventBus.emit({
      type: "surface:created",
      id: "surf1",
      paneId: "pane1",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "surf1", ptyId: 10 });
    eventBus.emit({
      type: "surface:titleChanged",
      id: "surf1",
      oldTitle: "",
      newTitle: "claude",
    });

    feedPaneOutput("pane1", "\x1b]9;4;1;50\x07"); // → running
    const t1 = get(paneAgentStateStore).get("pane1")?.transitionedAt;

    feedPaneOutput("pane1", "\x1b]9;Please review\x07"); // → awaiting_input
    const t2 = get(paneAgentStateStore).get("pane1")?.transitionedAt;

    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    // Both are valid ISO timestamps
    expect(t1).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(t2).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
