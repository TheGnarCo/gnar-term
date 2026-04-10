/**
 * Tests for the agentic-orchestrator included extension — validates manifest,
 * registration of surface type and command, and the StatusTracker state machine.
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
} from "../extensions/agentic-orchestrator";
import {
  surfaceTypeStore,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../lib/services/extension-loader";
import {
  createStatusTracker,
  type StatusTracker,
} from "../extensions/agentic-orchestrator/status-tracker";

// --- Manifest tests ---

describe("Agentic Orchestrator manifest", () => {
  it("has correct id and metadata", () => {
    expect(agenticOrchestratorManifest.id).toBe("agentic-orchestrator");
    expect(agenticOrchestratorManifest.name).toBe("Agentic Orchestrator");
    expect(agenticOrchestratorManifest.version).toBe("0.1.0");
    expect(agenticOrchestratorManifest.included).toBe(true);
  });

  it("declares pty permission", () => {
    expect(agenticOrchestratorManifest.permissions).toContain("pty");
  });

  it("declares a harness surface contribution", () => {
    expect(agenticOrchestratorManifest.contributes?.surfaces).toEqual([
      { id: "harness", label: "Harness" },
    ]);
  });

  it("declares a spawn-harness command contribution", () => {
    expect(agenticOrchestratorManifest.contributes?.commands).toEqual([
      { id: "spawn-harness", title: "Spawn Agent Harness..." },
    ]);
  });

  it("declares idleTimeout and defaultCommand settings", () => {
    const fields = agenticOrchestratorManifest.contributes?.settings?.fields;
    expect(fields).toBeTruthy();
    expect(fields!.idleTimeout).toMatchObject({
      type: "number",
      title: "Idle Timeout (seconds)",
      default: 30,
    });
    expect(fields!.defaultCommand).toMatchObject({
      type: "string",
      title: "Default Command",
      default: "",
    });
  });

  it("declares required events including custom harness event", () => {
    const events = agenticOrchestratorManifest.contributes?.events;
    expect(events).toContain("surface:created");
    expect(events).toContain("surface:closed");
    expect(events).toContain("extension:harness:statusChanged");
  });
});

// --- Registration tests ---

describe("Agentic Orchestrator registration", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSurfaceTypes();
    resetCommands();
  });

  it("registers surface type via API with namespaced id", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(1);
    expect(types[0].id).toBe("agentic-orchestrator:harness");
    expect(types[0].label).toBe("Harness");
    expect(types[0].source).toBe("agentic-orchestrator");
    expect(types[0].component).toBeTruthy();
  });

  it("registers spawn-harness command via API with namespaced id", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    const cmds = get(commandStore);
    const spawnCmd = cmds.find(
      (c) => c.id === "agentic-orchestrator:spawn-harness",
    );
    expect(spawnCmd).toBeTruthy();
    expect(spawnCmd!.title).toBe("Spawn Agent Harness...");
    expect(spawnCmd!.source).toBe("agentic-orchestrator");
  });
});

// --- StatusTracker tests ---

describe("StatusTracker", () => {
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
