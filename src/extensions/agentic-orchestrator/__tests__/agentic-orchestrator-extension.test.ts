/**
 * Tests for the agentic-orchestrator extension — validates manifest,
 * registration, detection logic, and the StatusTracker state machine.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  agenticOrchestratorManifest,
  registerAgenticOrchestratorExtension,
} from "..";
import {
  createStatusTracker,
  type StatusTracker,
  type TrackerMode as _TrackerMode,
} from "../status-tracker";
import {
  getAgents as _getAgents,
  registerAgent as _registerAgent,
  resetRegistry as _resetRegistry,
} from "../agent-registry";
import {
  registerExtension,
  activateExtension,
  deactivateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import { eventBus } from "../../../lib/services/event-bus";
import {
  agentStatusStore,
  resetAgentStatuses,
} from "../../../lib/stores/agent-status";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";
import type { Workspace } from "../../../lib/types";
import type { AppEvent } from "../../../lib/services/event-bus";

// --- Manifest tests ---

describe("Agentic Orchestrator manifest", () => {
  it("has correct id and metadata", () => {
    expect(agenticOrchestratorManifest.id).toBe("agentic-orchestrator");
    expect(agenticOrchestratorManifest.name).toBe("Agentic Orchestrator");
    expect(agenticOrchestratorManifest.version).toBe("0.2.0");
    expect(agenticOrchestratorManifest.included).toBe(true);
  });

  it("declares observe permission", () => {
    expect(agenticOrchestratorManifest.permissions).toContain("observe");
  });

  it("does not declare surfaces or commands", () => {
    expect(agenticOrchestratorManifest.contributes?.surfaces).toBeUndefined();
    expect(agenticOrchestratorManifest.contributes?.commands).toBeUndefined();
    expect(
      agenticOrchestratorManifest.contributes?.workspaceActions,
    ).toBeUndefined();
  });

  it("declares idleTimeout and knownAgents settings", () => {
    const fields = agenticOrchestratorManifest.contributes?.settings?.fields;
    expect(fields).toBeTruthy();
    expect(fields!.idleTimeout).toMatchObject({
      type: "number",
      title: "Idle Timeout (seconds)",
      default: 30,
    });
    expect(fields!.knownAgents).toMatchObject({
      type: "string",
      default: "[]",
    });
  });

  it("declares required events including titleChanged", () => {
    const events = agenticOrchestratorManifest.contributes?.events;
    expect(events).toContain("surface:created");
    expect(events).toContain("surface:closed");
    expect(events).toContain("surface:titleChanged");
    expect(events).toContain("extension:harness:statusChanged");
  });

  it("declares secondary sidebar tab", () => {
    const tabs = agenticOrchestratorManifest.contributes?.secondarySidebarTabs;
    expect(tabs).toBeDefined();
    const agentsTab = tabs!.find((t) => t.id === "agents");
    expect(agentsTab).toBeDefined();
    expect(agentsTab!.label).toBe("Agents");
  });
});

// --- StatusTracker tests (OSC mode — default) ---

describe("StatusTracker (osc mode)", () => {
  let tracker: StatusTracker;
  let statusChanges: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    statusChanges = [];
    tracker = createStatusTracker(5000, (s) => {
      statusChanges.push(s);
    });
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it("starts with idle status", () => {
    expect(tracker.getStatus()).toBe("idle");
  });

  it("transitions to running on output", () => {
    tracker.onOutput();
    expect(tracker.getStatus()).toBe("running");
    expect(statusChanges).toEqual(["running"]);
  });

  it("transitions to waiting on notification", () => {
    tracker.onOutput();
    tracker.onNotification("agent needs input");
    expect(tracker.getStatus()).toBe("waiting");
    expect(statusChanges).toEqual(["running", "waiting"]);
  });

  it("transitions to idle after timeout with no output", () => {
    tracker.onOutput();
    expect(tracker.getStatus()).toBe("running");

    vi.advanceTimersByTime(5000);
    expect(tracker.getStatus()).toBe("idle");
    expect(statusChanges).toEqual(["running", "idle"]);
  });

  it("resets idle timer on each output", () => {
    tracker.onOutput();
    vi.advanceTimersByTime(3000);
    tracker.onOutput();
    vi.advanceTimersByTime(3000);
    // Only 3s since last output, should still be running
    expect(tracker.getStatus()).toBe("running");

    vi.advanceTimersByTime(2000);
    // Now 5s since last output, should be idle
    expect(tracker.getStatus()).toBe("idle");
  });

  it("title containing 'thinking' sets running", () => {
    tracker.onTitleChange("Agent is thinking...");
    expect(tracker.getStatus()).toBe("running");
  });

  it("title containing 'working' sets running", () => {
    tracker.onTitleChange("Working on task");
    expect(tracker.getStatus()).toBe("running");
  });

  it("title containing 'ready' sets idle", () => {
    tracker.onOutput(); // running
    tracker.onTitleChange("Ready for input");
    expect(tracker.getStatus()).toBe("idle");
  });

  it("title containing 'done' sets idle", () => {
    tracker.onOutput(); // running
    tracker.onTitleChange("Task done");
    expect(tracker.getStatus()).toBe("idle");
  });

  it("does not fire callback when status does not change", () => {
    tracker.onOutput();
    tracker.onOutput();
    tracker.onOutput();
    // Only one transition: idle -> running
    expect(statusChanges).toEqual(["running"]);
  });

  it("waiting clears idle timer so it does not fire", () => {
    tracker.onOutput();
    tracker.onNotification("waiting");
    vi.advanceTimersByTime(10000);
    // Should still be waiting, not idle
    expect(tracker.getStatus()).toBe("waiting");
  });

  it("destroy clears pending idle timer", () => {
    tracker.onOutput();
    tracker.destroy();
    vi.advanceTimersByTime(10000);
    // Status should still be running — timer was cleared
    expect(tracker.getStatus()).toBe("running");
    expect(statusChanges).toEqual(["running"]);
  });
});

// --- StatusTracker tests (title-only mode) ---

describe("StatusTracker (title-only mode)", () => {
  let tracker: StatusTracker;
  let statusChanges: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    statusChanges = [];
    tracker = createStatusTracker(
      5000,
      (s) => {
        statusChanges.push(s);
      },
      "title-only",
    );
  });

  afterEach(() => {
    tracker.destroy();
    vi.useRealTimers();
  });

  it("starts with idle status", () => {
    expect(tracker.getStatus()).toBe("idle");
  });

  it("transitions to active (not running) on output", () => {
    tracker.onOutput();
    expect(tracker.getStatus()).toBe("active");
    expect(statusChanges).toEqual(["active"]);
  });

  it("onNotification is a no-op in title-only mode", () => {
    tracker.onOutput();
    tracker.onNotification("some notification");
    // Should still be active, not waiting
    expect(tracker.getStatus()).toBe("active");
    expect(statusChanges).toEqual(["active"]);
  });

  it("transitions to idle after timeout", () => {
    tracker.onOutput();
    vi.advanceTimersByTime(5000);
    expect(tracker.getStatus()).toBe("idle");
    expect(statusChanges).toEqual(["active", "idle"]);
  });

  it("title containing 'thinking' sets active (not running)", () => {
    tracker.onTitleChange("Agent is thinking...");
    expect(tracker.getStatus()).toBe("active");
  });
});

// --- Deactivation cleanup (H2 regression test) ---

describe("Orchestrator deactivation cleanup", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetAgentStatuses();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  afterEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetAgentStatuses();
  });

  it("bootstraps tracking for surfaces in background workspaces and split panes (H3)", async () => {
    // Two workspaces — the active one has a split pane, the background one is
    // a single pane. Both contain a "claude" terminal surface that matches
    // the default orchestrator pattern.
    workspaces.set([
      {
        id: "ws-active",
        name: "Active",
        activePaneId: "p-left",
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            {
              type: "pane",
              pane: {
                id: "p-left",
                activeSurfaceId: "s-left",
                surfaces: [
                  {
                    id: "s-left",
                    kind: "terminal",
                    title: "zsh", // not an agent
                    ptyId: 1,
                    terminal: { dispose: vi.fn(), focus: vi.fn() },
                  },
                ],
              },
            },
            {
              type: "pane",
              pane: {
                id: "p-right",
                activeSurfaceId: "s-right-claude",
                surfaces: [
                  {
                    id: "s-right-claude",
                    kind: "terminal",
                    title: "claude", // agent in split pane
                    ptyId: 2,
                    terminal: { dispose: vi.fn(), focus: vi.fn() },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        id: "ws-bg",
        name: "Background",
        activePaneId: "p-bg",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p-bg",
            activeSurfaceId: "s-bg-claude",
            surfaces: [
              {
                id: "s-bg-claude",
                kind: "terminal",
                title: "claude", // agent in background workspace
                ptyId: 3,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
    ] as unknown as Workspace[]);
    activeWorkspaceIdx.set(0);

    // Drain any agents left in the module-global registry from prior tests.
    _resetRegistry();

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    // After bootstrap: both "claude" surfaces should have agents attached.
    const agents = _getAgents();
    const attachedSurfaceIds = agents.map((a) => a.surfaceId).sort();
    expect(attachedSurfaceIds).toEqual(["s-bg-claude", "s-right-claude"]);

    // And the agents are bound to the correct workspace ids (C2 guard).
    const bgAgent = agents.find((a) => a.surfaceId === "s-bg-claude");
    expect(bgAgent?.workspaceId).toBe("ws-bg");
    const splitAgent = agents.find((a) => a.surfaceId === "s-right-claude");
    expect(splitAgent?.workspaceId).toBe("ws-active");
  });

  it("surfaces observer errors via reportExtensionError instead of silent freeze (H5)", async () => {
    // If the tracker's onOutput throws (e.g., bad user-supplied pattern
    // corrupts internal state), the current observer would swallow it
    // silently and leave the agent dot frozen. Fix: report the error so
    // the user sees a toast.
    const tracker = await import("../status-tracker");
    const spy = vi
      .spyOn(tracker, "createStatusTracker")
      .mockImplementation(() => ({
        onOutput: () => {
          throw new Error("boom");
        },
        onNotification: () => {},
        onTitleChange: () => {},
        getStatus: () => "idle",
        destroy: () => {},
      }));

    workspaces.set([
      {
        id: "ws-err",
        name: "Err",
        activePaneId: "p",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p",
            activeSurfaceId: "s-err",
            surfaces: [
              {
                id: "s-err",
                kind: "terminal",
                title: "claude",
                ptyId: 99,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
    ] as unknown as Workspace[]);
    activeWorkspaceIdx.set(0);

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    // Drive output through the observer. surfaceOutputObserver dispatches by
    // ptyId, and the orchestrator subscribed via onSurfaceOutput which
    // resolved ptyId=99 from the workspace store.
    const obs = await import("../../../lib/services/surface-output-observer");
    obs.notifyOutputObservers(99, "some output chunk");

    const loader = await import("../../../lib/services/extension-loader");
    const errs = get(loader.extensionErrorStore);
    expect(
      errs.some((e) => e.id === "agentic-orchestrator" && /boom/.test(e.error)),
    ).toBe(true);

    spy.mockRestore();
  });

  it("clears _agent workspace indicators for tracked agents on deactivate", async () => {
    // Seed a workspace with a terminal surface that matches the "claude" pattern.
    workspaces.set([
      {
        id: "ws-claude",
        name: "Claude",
        activePaneId: "p1",
        splitRoot: {
          type: "pane",
          pane: {
            id: "p1",
            activeSurfaceId: "s1",
            surfaces: [
              {
                id: "s1",
                kind: "terminal",
                title: "claude",
                ptyId: 1,
                terminal: { dispose: vi.fn(), focus: vi.fn() },
              },
            ],
          },
        },
      },
    ] as unknown as Workspace[]);
    activeWorkspaceIdx.set(0);

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    // Explicitly emit surface:created with title to drive attachAgent.
    // (The bootstrap subscription will have also attached via activePane;
    // handleSurfaceCreated's trackedSurfaces.set is idempotent-ish.)
    eventBus.emit({
      type: "surface:created",
      id: "s1",
      paneId: "p1",
      kind: "terminal",
      title: "claude",
    } as AppEvent);

    // Simulate a status change arriving from the tracker.
    eventBus.emit({
      type: "extension:harness:statusChanged",
      status: "running",
      workspaceId: "ws-claude",
      surfaceId: "s1",
    });

    // Precondition: _agent status populated.
    expect(get(agentStatusStore)["ws-claude"]).toBe("running");

    // Act: deactivate the orchestrator.
    deactivateExtension("agentic-orchestrator");

    // Bug before fix: _agent item persists because REGISTRY_CLEANUP_FNS only
    // clears items sourced with the extension id, not "_agent".
    expect(get(agentStatusStore)["ws-claude"]).toBeUndefined();
  });
});
