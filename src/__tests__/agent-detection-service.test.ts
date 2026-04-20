/**
 * Tests for the core agent-detection-service.
 *
 * Exercises the full detection pipeline: pattern matching, attach/detach
 * lifecycle driven by surface events, status transitions via title
 * changes, workspace indicator / per-surface status writes, registry
 * mirror, and init/destroy idempotency.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/stores/workspace", async () => {
  const { writable: w } = await import("svelte/store");
  return { workspaces: w([]) };
});

import {
  agentsStore,
  getAgents,
  initAgentDetection,
  destroyAgentDetection,
  resetAgentDetectionForTests,
} from "../lib/services/agent-detection-service";
import { eventBus, type AppEvent } from "../lib/services/event-bus";
import { workspaces } from "../lib/stores/workspace";
import { agentStatusStore } from "../lib/stores/agent-status";
import { statusRegistry } from "../lib/services/status-registry";

const consoleErrorSpy = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

beforeEach(() => {
  resetAgentDetectionForTests();
  workspaces.set([]);
});

afterEach(() => {
  destroyAgentDetection();
  consoleErrorSpy.mockClear();
});

function makeWorkspace(
  id: string,
  surfaces: Array<{ id: string; title: string; ptyId?: number }>,
) {
  return {
    id,
    name: id,
    activePaneId: "p",
    splitRoot: {
      type: "pane" as const,
      pane: {
        id: "p",
        activeSurfaceId: surfaces[0]?.id ?? null,
        surfaces: surfaces.map((s) => ({
          id: s.id,
          kind: "terminal" as const,
          title: s.title,
          cwd: "/tmp",
          ptyId: s.ptyId ?? 0,
          terminal: { dispose: vi.fn(), focus: vi.fn() },
        })),
      },
    },
  };
}

describe("agent-detection-service — basics", () => {
  it("exposes an empty reactive registry before init", () => {
    expect(get(agentsStore)).toEqual([]);
    expect(getAgents()).toEqual([]);
  });

  it("initAgentDetection is idempotent — second call tears down the first", () => {
    initAgentDetection();
    initAgentDetection();
    eventBus.emit({
      type: "surface:created",
      id: "ghost",
      paneId: "p",
      kind: "terminal",
    });
    expect(getAgents()).toEqual([]);
  });

  it("ignores non-terminal surface:created events", () => {
    initAgentDetection();
    eventBus.emit({
      type: "surface:created",
      id: "x",
      paneId: "p",
      kind: "preview",
    });
    expect(getAgents()).toEqual([]);
  });

  it("destroyAgentDetection clears the registry", () => {
    initAgentDetection();
    destroyAgentDetection();
    expect(get(agentsStore)).toEqual([]);
  });
});

describe("agent-detection-service — attach on matching title", () => {
  it("bootstraps detection for pre-existing terminals whose title matches", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 1 }]),
    ]);
    initAgentDetection();
    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentName).toBe("Claude Code");
    expect(agents[0]?.workspaceId).toBe("w1");
    expect(agents[0]?.surfaceId).toBe("s1");
  });

  it("attaches to a newly-created terminal on surface:created", () => {
    initAgentDetection();
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "codex repl", ptyId: 2 }]),
    ]);
    eventBus.emit({
      type: "surface:created",
      id: "s1",
      paneId: "p",
      kind: "terminal",
    });
    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentName).toBe("Codex");
  });

  it("does not attach when the title does not match any pattern", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "bash", ptyId: 3 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toEqual([]);
  });

  it("resolves the workspace id from the surface, not the active workspace", () => {
    workspaces.set([
      makeWorkspace("w-other", [{ id: "other", title: "bash", ptyId: 9 }]),
      makeWorkspace("w-target", [{ id: "s1", title: "claude", ptyId: 1 }]),
    ]);
    initAgentDetection();
    const agents = getAgents();
    expect(agents[0]?.workspaceId).toBe("w-target");
  });
});

describe("agent-detection-service — detach on surface:closed", () => {
  it("removes the agent from the registry on close", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "aider", ptyId: 4 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toHaveLength(1);

    eventBus.emit({ type: "surface:closed", id: "s1", paneId: "p" });
    expect(getAgents()).toHaveLength(0);
  });

  it("handles surface:closed for an untracked surface as a no-op", () => {
    initAgentDetection();
    expect(() => {
      eventBus.emit({ type: "surface:closed", id: "unknown", paneId: "p" });
    }).not.toThrow();
  });
});

describe("agent-detection-service — title transitions", () => {
  it("attaches when a title changes to match after initial mismatch", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "zsh", ptyId: 5 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toEqual([]);

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "zsh",
      newTitle: "claude is thinking",
    });
    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentName).toBe("Claude Code");
  });

  it("detaches when the title changes away from a matching pattern", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 6 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toHaveLength(1);

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "zsh",
    });
    expect(getAgents()).toHaveLength(0);
  });

  it("forwards title changes to the tracker while the agent stays matched", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 7 }]),
    ]);
    initAgentDetection();
    expect(getAgents()[0]?.status).toBe("idle");

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });
    expect(getAgents()[0]?.status).toBe("running");
  });

  it("ignores title changes for untracked surfaces", () => {
    initAgentDetection();
    expect(() => {
      eventBus.emit({
        type: "surface:titleChanged",
        id: "ghost",
        oldTitle: "x",
        newTitle: "claude",
      });
    }).not.toThrow();
    expect(getAgents()).toEqual([]);
  });
});

describe("agent-detection-service — status publishing", () => {
  it("emits agent:statusChanged when the tracker transitions", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 8 }]),
    ]);

    const captured: AppEvent[] = [];
    const handler = (e: AppEvent) => captured.push(e);
    eventBus.on("agent:statusChanged", handler);

    initAgentDetection();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });

    eventBus.off("agent:statusChanged", handler);

    const running = captured.find(
      (e) =>
        e.type === "agent:statusChanged" &&
        (e as { status: string }).status === "running",
    );
    expect(running).toBeDefined();
  });

  it("writes a workspace indicator on status change", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 10 }]),
    ]);
    initAgentDetection();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });

    expect(get(agentStatusStore).w1).toBe("running");
  });

  it("clears the workspace indicator on detach", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 11 }]),
    ]);
    initAgentDetection();
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });
    expect(get(agentStatusStore).w1).toBe("running");

    eventBus.emit({ type: "surface:closed", id: "s1", paneId: "p" });
    expect(get(agentStatusStore).w1).toBeUndefined();
  });

  it("writes a per-surface status item keyed by `surface:<id>`", () => {
    workspaces.set([
      makeWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 12 }]),
    ]);
    initAgentDetection();
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });

    const items = get(statusRegistry.store);
    const surfaceItem = items.find(
      (i) =>
        i.source === "_agent" &&
        i.workspaceId === "w1" &&
        i.metadata?.surfaceId === "s1" &&
        i.id !== "_agent:w1:default",
    );
    expect(surfaceItem).toBeDefined();
    expect(surfaceItem?.label).toBe("running");
    expect(surfaceItem?.variant).toBe("success");
  });
});

describe("agent-detection-service — event bus contract", () => {
  it("agent:statusChanged is accepted by the bus with the declared payload", () => {
    let captured: AppEvent | null = null;
    const handler = (e: AppEvent) => {
      captured = e;
    };
    eventBus.on("agent:statusChanged", handler);
    eventBus.emit({
      type: "agent:statusChanged",
      status: "running",
      surfaceId: "s1",
      workspaceId: "w1",
      agentName: "Claude Code",
    });
    eventBus.off("agent:statusChanged", handler);
    expect(captured).not.toBeNull();
    expect(captured!.type).toBe("agent:statusChanged");
  });
});
