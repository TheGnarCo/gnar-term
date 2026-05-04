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

vi.mock("../lib/stores/nested-workspace", async () => {
  const { writable: w } = await import("svelte/store");
  return { nestedWorkspaces: w([]) };
});

import {
  agentsStore,
  getAgents,
  getAgentByAgentId,
  getAgentBySurfaceId,
  initAgentDetection,
  destroyAgentDetection,
  resetAgentDetectionForTests,
} from "../lib/services/agent-detection-service";
import { eventBus, type AppEvent } from "../lib/services/event-bus";
import { nestedWorkspaces } from "../lib/stores/nested-workspace";
import { statusRegistry } from "../lib/services/status-registry";
import { notifyOutputObservers } from "../lib/services/surface-output-observer";

const consoleErrorSpy = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

beforeEach(() => {
  resetAgentDetectionForTests();
  nestedWorkspaces.set([]);
});

afterEach(() => {
  destroyAgentDetection();
  consoleErrorSpy.mockClear();
});

function makeNestedWorkspace(
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
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 1 }]),
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
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "codex repl", ptyId: 2 }]),
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
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "bash", ptyId: 3 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toEqual([]);
  });

  it("resolves the workspace id from the surface, not the active workspace", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w-other", [
        { id: "other", title: "bash", ptyId: 9 },
      ]),
      makeNestedWorkspace("w-target", [
        { id: "s1", title: "claude", ptyId: 1 },
      ]),
    ]);
    initAgentDetection();
    const agents = getAgents();
    expect(agents[0]?.workspaceId).toBe("w-target");
  });
});

describe("agent-detection-service — detach on surface:closed", () => {
  it("removes the agent from the registry on close", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "aider", ptyId: 4 }]),
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
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "zsh", ptyId: 5 }]),
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

  it("detaches when the title changes away from a matching pattern (after debounce)", () => {
    vi.useFakeTimers();
    try {
      nestedWorkspaces.set([
        makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 6 }]),
      ]);
      initAgentDetection();
      expect(getAgents()).toHaveLength(1);

      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "claude",
        newTitle: "zsh",
      });
      // Still attached immediately after the title change
      expect(getAgents()).toHaveLength(1);

      // Advance past the debounce window — now detaches
      vi.advanceTimersByTime(5_000);
      expect(getAgents()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not detach when title briefly loses match then recovers (flicker)", () => {
    vi.useFakeTimers();
    try {
      nestedWorkspaces.set([
        makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 6 }]),
      ]);
      initAgentDetection();
      expect(getAgents()).toHaveLength(1);

      // Title flickers away from "claude"
      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "claude",
        newTitle: "zsh",
      });
      expect(getAgents()).toHaveLength(1);

      // Title comes back with "claude" within the debounce window
      vi.advanceTimersByTime(1_000);
      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "zsh",
        newTitle: "claude thinking",
      });

      // Advance well past the original debounce — agent must still be attached
      vi.advanceTimersByTime(5_000);
      expect(getAgents()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards title changes to the tracker while the agent stays matched", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 7 }]),
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
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 8 }]),
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
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 10 }]),
    ]);
    initAgentDetection();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });

    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.workspaceId === "w1",
    );
    expect(item?.label).toBe("running");
  });

  it("clears the workspace indicator on detach", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 11 }]),
    ]);
    initAgentDetection();
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });
    expect(
      get(statusRegistry.store).find(
        (i) => i.source === "_agent" && i.workspaceId === "w1",
      )?.label,
    ).toBe("running");

    eventBus.emit({ type: "surface:closed", id: "s1", paneId: "p" });
    expect(
      get(statusRegistry.store).find(
        (i) => i.source === "_agent" && i.workspaceId === "w1",
      ),
    ).toBeUndefined();
  });

  it("writes exactly one status-registry item per attached agent", () => {
    // Regression: we used to call setAgentStatus(workspaceId, status)
    // AND setStatusItem per-surface. Both landed in the registry under
    // source=_agent, category=process, so aggregateAgentBadges counted
    // one attached agent as two and the WorkspaceItem tooltip read
    // "2 idle" for a lone agent. Verify we now write a single entry.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 21 }]),
    ]);
    initAgentDetection();
    const items = get(statusRegistry.store).filter(
      (i) => i.source === "_agent" && i.workspaceId === "w1",
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.metadata?.surfaceId).toBe("s1");
  });

  it("publishes a muted (idle) status item immediately on attach", () => {
    // Regression: the status tracker starts at "idle" but only emits
    // transitions, so the initial idle state used to leave the
    // status-registry empty — the sidebar workspace chip would then be
    // missing until the first output/title change. Verify that a
    // freshly attached agent has a muted status item written.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 20 }]),
    ]);
    initAgentDetection();

    const items = get(statusRegistry.store);
    const surfaceItem = items.find(
      (i) =>
        i.source === "_agent" &&
        i.workspaceId === "w1" &&
        i.metadata?.surfaceId === "s1",
    );
    expect(surfaceItem).toBeDefined();
    expect(surfaceItem?.label).toBe("idle");
    expect(surfaceItem?.variant).toBe("muted");
  });

  it("writes a per-surface status item keyed by `surface:<id>`", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 12 }]),
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

describe("agent-detection-service — OSC output classification", () => {
  it("treats title OSC (0/2) as output, not as notification", () => {
    // Regression: the observer used to treat any `ESC ]` byte as an
    // OSC notification, which meant every OSC 0/2 title ping pinned
    // OSC-mode agents in "waiting" forever. Claude Code updates its
    // title frequently, so users saw the idle/running state stuck.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 30 }]),
    ]);
    initAgentDetection();

    // Simulate Claude emitting a title sequence. Must NOT transition to
    // "waiting" (which would also cancel the idle timer).
    notifyOutputObservers(30, "\x1b]2;✻ Claude Code\x07");

    const items = get(statusRegistry.store);
    const surfaceItem = items.find(
      (i) => i.metadata?.surfaceId === "s1" && i.source === "_agent",
    );
    // "running" (osc mode) or the initial "idle" is fine — both are
    // not "waiting", which is what the regression produced.
    expect(surfaceItem?.label).not.toBe("waiting");
  });

  it("treats OSC 9 as notification (transitions to waiting)", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 31 }]),
    ]);
    initAgentDetection();

    notifyOutputObservers(31, "\x1b]9;Claude Code: response ready\x07");

    const items = get(statusRegistry.store);
    const surfaceItem = items.find(
      (i) => i.metadata?.surfaceId === "s1" && i.source === "_agent",
    );
    expect(surfaceItem?.label).toBe("waiting");
    expect(surfaceItem?.variant).toBe("warning");
  });

  it("wires the observer only once the PTY id is real", () => {
    // Regression: surface:created fires with ptyId = -1 (the real id
    // is assigned later by connectPty). Observers registered against
    // -1 never receive data, so launching claude in a fresh surface
    // never produced a chip. Agent detection now waits for
    // surface:ptyReady before wiring the observer — simulate that
    // flow and make sure output routed to the real ptyId attaches.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "Shell 1", ptyId: -1 }]),
    ]);
    initAgentDetection();

    // Early output (no observer wired yet — placeholder ptyId) must
    // not attach an agent.
    notifyOutputObservers(40, "some early output");
    expect(getAgents()).toHaveLength(0);

    // PTY becomes ready. Backfill the workspace state so the
    // agent-detection cache can resolve it, then emit the event.
    nestedWorkspaces.update((list) => {
      const ws = list[0];
      if (!ws) return list;
      for (const p of [ws.splitRoot].flatMap((r) =>
        r.type === "pane" ? [r.pane] : [],
      )) {
        for (const s of p.surfaces) {
          if (s.id === "s1" && "ptyId" in s) {
            (s as { ptyId: number }).ptyId = 40;
          }
        }
      }
      return list;
    });
    eventBus.emit({ type: "surface:ptyReady", id: "s1", ptyId: 40 });

    // Claude Code is OSC-detectable so title change (not raw output)
    // is the detection signal. Emit a title change with "claude".
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "Shell 1",
      newTitle: "claude",
    });
    expect(getAgents()).toHaveLength(1);
    expect(getAgents()[0]?.agentName).toBe("Claude Code");
  });

  it("treats OSC 777 as notification", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 32 }]),
    ]);
    initAgentDetection();

    notifyOutputObservers(32, "\x1b]777;notify;Claude Code;done\x07");

    const items = get(statusRegistry.store);
    const surfaceItem = items.find(
      (i) => i.metadata?.surfaceId === "s1" && i.source === "_agent",
    );
    expect(surfaceItem?.label).toBe("waiting");
  });
});

describe("agent-detection-service — lifecycle hygiene", () => {
  it("sweeps _agent items from the registry on destroy", () => {
    // Regression: destroyAgentDetection used to leave stale per-surface
    // items in the registry if a tracker's workspace id fell out of
    // sync. A subsequent init then inherited ghost chips. Confirm the
    // destroy path clears every `_agent` item.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 50 }]),
    ]);
    initAgentDetection();
    expect(
      get(statusRegistry.store).filter((i) => i.source === "_agent").length,
    ).toBeGreaterThan(0);

    destroyAgentDetection();
    const leftover = get(statusRegistry.store).filter(
      (i) => i.source === "_agent",
    );
    expect(leftover).toEqual([]);
  });

  it("rewires the observer when surface:ptyReady fires with a new ptyId", () => {
    // Regression guard: if spawn_pty resolves twice (retry), the
    // second ptyReady carries a different ptyId. The observer must
    // unbind from the stale id and re-bind to the new one — otherwise
    // output on the live pty is silently dropped.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "Shell 1", ptyId: -1 }]),
    ]);
    initAgentDetection();
    eventBus.emit({ type: "surface:ptyReady", id: "s1", ptyId: 100 });
    // First id is stale — data on it must not attach after rewire.
    eventBus.emit({ type: "surface:ptyReady", id: "s1", ptyId: 101 });

    // Old pty id should no longer route to the observer.
    notifyOutputObservers(100, "some output on stale pty");
    expect(getAgents()).toHaveLength(0);

    // Title change on the live pty triggers detection (Claude Code is
    // OSC-detectable — title is the authoritative signal, not output).
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "Shell 1",
      newTitle: "claude",
    });
    expect(getAgents()).toHaveLength(1);
  });
});

describe("agent-detection-service — late workspace load (startup race)", () => {
  it("attaches agent when nestedWorkspaces load after surface:created and surface:ptyReady", () => {
    // Simulates the startup race: Tauri emits surface events before the
    // workspace store is populated, so allTerminalSurfaces() returned []
    // and the surface was tracked with no agent. When the workspace loads
    // later, the agent should now be detected.
    initAgentDetection();

    eventBus.emit({
      type: "surface:created",
      id: "s1",
      paneId: "p",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "s1", ptyId: 60 });
    expect(getAgents()).toHaveLength(0);

    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 60 }]),
    ]);

    expect(getAgents()).toHaveLength(1);
    expect(getAgents()[0]?.workspaceId).toBe("w1");
    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
    );
    expect(item).toBeDefined();
    expect(item?.label).toBe("idle");
  });

  it("backfills idle status item when title changes to match before workspace loads", () => {
    // Regression: surface:titleChanged fires with "claude" before nestedWorkspaces
    // load. attachAgent() captures workspaceId = "" so the initial
    // publishStatus("idle") writes nothing. The workspace subscription skipped
    // already-attached agents, so the status item was NEVER written.
    initAgentDetection();

    eventBus.emit({
      type: "surface:created",
      id: "s1",
      paneId: "p",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "s1", ptyId: 62 });

    // Title changes to "claude" while nestedWorkspaces aren't loaded yet —
    // agent attaches but has no workspace → status item cannot be written.
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "",
      newTitle: "claude",
    });
    expect(getAgents()).toHaveLength(1);
    expect(getAgents()[0]?.workspaceId).toBe("");

    // No status item yet — workspaceId was empty.
    expect(
      get(statusRegistry.store).find(
        (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
      ),
    ).toBeUndefined();

    // NestedWorkspace loads — subscription should backfill the idle status item.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 62 }]),
    ]);

    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
    );
    expect(item).toBeDefined();
    expect(item?.label).toBe("idle");
    expect(item?.variant).toBe("muted");
    expect(getAgents()[0]?.workspaceId).toBe("w1");
  });

  it("publishes waiting status after workspace loads late then OSC fires", () => {
    // The dot must show when Claude uses AskUserQuestion after nestedWorkspaces
    // were loaded post-surface-events — this was the reported "no dot" bug.
    initAgentDetection();
    eventBus.emit({
      type: "surface:created",
      id: "s1",
      paneId: "p",
      kind: "terminal",
    });
    eventBus.emit({ type: "surface:ptyReady", id: "s1", ptyId: 61 });

    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 61 }]),
    ]);
    expect(getAgents()).toHaveLength(1);

    notifyOutputObservers(61, "\x1b]9;waiting for response\x07");

    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
    );
    expect(item?.label).toBe("waiting");
    expect(item?.variant).toBe("warning");
  });
});

describe("agent-detection-service — workspace:closed cleanup", () => {
  it("removes agents from a workspace when workspace:closed fires", () => {
    // closeNestedWorkspace() emits workspace:closed but NOT surface:closed for
    // each terminal, so agents were lingering as idle after a workspace close.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 10 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toHaveLength(1);
    expect(getAgents()[0]!.workspaceId).toBe("w1");

    eventBus.emit({ type: "workspace:closed", id: "w1" });

    expect(getAgents()).toHaveLength(0);
  });

  it("does not affect agents in other nestedWorkspaces when one closes", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 11 }]),
      makeNestedWorkspace("w2", [{ id: "s2", title: "claude", ptyId: 12 }]),
    ]);
    initAgentDetection();
    expect(getAgents()).toHaveLength(2);

    eventBus.emit({ type: "workspace:closed", id: "w1" });

    const remaining = getAgents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.workspaceId).toBe("w2");
  });
});

describe("agent-detection-service — title restoration on agent close", () => {
  it("restores surface title to pre-agent name when title changes away from match (after debounce)", () => {
    vi.useFakeTimers();
    try {
      const ws = makeNestedWorkspace("w1", [
        { id: "s1", title: "zsh", ptyId: 50 },
      ]);
      nestedWorkspaces.set([ws]);
      initAgentDetection();
      expect(getAgents()).toHaveLength(0);

      const surface = ws.splitRoot.pane.surfaces[0]!;
      surface.title = "claude";
      nestedWorkspaces.update((l) => [...l]);

      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "zsh",
        newTitle: "claude",
      });
      expect(getAgents()).toHaveLength(1);

      surface.title = "zsh";
      nestedWorkspaces.update((l) => [...l]);
      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "claude",
        newTitle: "zsh",
      });

      vi.advanceTimersByTime(5_000);
      expect(getAgents()).toHaveLength(0);
      expect(surface.title).toBe("zsh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores surface title to pre-agent name when the surface is closed", () => {
    const ws = makeNestedWorkspace("w1", [
      { id: "s1", title: "bash", ptyId: 51 },
    ]);
    nestedWorkspaces.set([ws]);
    initAgentDetection();

    const surface = ws.splitRoot.pane.surfaces[0]!;
    surface.title = "claude";
    nestedWorkspaces.update((l) => [...l]);
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "bash",
      newTitle: "claude",
    });
    expect(getAgents()).toHaveLength(1);

    surface.title = "Claude Code (thinking...)";
    nestedWorkspaces.update((l) => [...l]);

    eventBus.emit({ type: "surface:closed", id: "s1", paneId: "p" });
    expect(getAgents()).toHaveLength(0);
    expect(surface.title).toBe("bash");
  });

  it("does not restore title when bootstrapped with agent title already active (after debounce)", () => {
    vi.useFakeTimers();
    try {
      const ws = makeNestedWorkspace("w1", [
        { id: "s1", title: "claude", ptyId: 52 },
      ]);
      nestedWorkspaces.set([ws]);
      initAgentDetection();
      expect(getAgents()).toHaveLength(1);

      const surface = ws.splitRoot.pane.surfaces[0]!;
      surface.title = "zsh";
      nestedWorkspaces.update((l) => [...l]);
      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "claude",
        newTitle: "zsh",
      });

      vi.advanceTimersByTime(5_000);
      expect(getAgents()).toHaveLength(0);
      expect(surface.title).toBe("zsh");
    } finally {
      vi.useRealTimers();
    }
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

describe("agent-detection-service — agentsStore reactive subscriber", () => {
  it("agentsStore subscriber receives updated status when an agent transitions via title change", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 99 }]),
    ]);
    initAgentDetection();

    // Collect every value the store emits via subscribe (not getAgents snapshots).
    const emissions: Array<{ status: string }[]> = [];
    const unsub = agentsStore.subscribe((agents) => {
      emissions.push(agents.map((a) => ({ status: a.status })));
    });

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude working",
    });

    unsub();

    // The subscriber must have fired at least twice: initial value + after status change.
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    // The last emission reflects the new status.
    const last = emissions[emissions.length - 1];
    expect(last).toHaveLength(1);
    expect(last![0]!.status).toBe("running");
  });

  it("agentsStore subscriber receives an updated list when a new agent is attached via title change", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s2", title: "zsh", ptyId: 100 }]),
    ]);
    initAgentDetection();

    const emissions: number[] = [];
    const unsub = agentsStore.subscribe((agents) => {
      emissions.push(agents.length);
    });

    // Trigger attachment by title change.
    eventBus.emit({
      type: "surface:titleChanged",
      id: "s2",
      oldTitle: "zsh",
      newTitle: "aider (working)",
    });

    unsub();

    // Started at 0, then climbed to 1 after attachment.
    expect(emissions).toContain(0);
    expect(emissions[emissions.length - 1]).toBe(1);
  });
});

describe("agent-detection-service — active status (non-OSC agents)", () => {
  it("title-only agents emit 'active' status on output, not 'running'", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "cursor", ptyId: 110 }]),
    ]);
    initAgentDetection();
    expect(getAgents()[0]?.status).toBe("idle");

    notifyOutputObservers(110, "some output");

    expect(getAgents()[0]?.status).toBe("active");
  });

  it("'active' status writes a success variant to the registry (not muted)", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "cursor", ptyId: 111 }]),
    ]);
    initAgentDetection();
    notifyOutputObservers(111, "some output");

    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
    );
    expect(item?.label).toBe("active");
    expect(item?.variant).toBe("success");
  });
});

describe("agent-detection-service — repeat waiting notification", () => {
  it("fires onStatusChange on every OSC notification even when already waiting", () => {
    // Regression: setStatus() dedup was silently swallowing the second
    // notification while already in "waiting" state, so markSurfaceUnreadById
    // (and the unread badge) never re-triggered for a second prompt.
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 120 }]),
    ]);
    initAgentDetection();

    const events: string[] = [];
    const handler = (e: { type: string; status: string }) =>
      events.push(e.status);
    eventBus.on(
      "agent:statusChanged",
      handler as Parameters<typeof eventBus.on>[1],
    );

    notifyOutputObservers(120, "\x1b]9;first prompt\x07");
    notifyOutputObservers(120, "\x1b]9;second prompt\x07");

    eventBus.off(
      "agent:statusChanged",
      handler as Parameters<typeof eventBus.off>[1],
    );

    const waitingCount = events.filter((s) => s === "waiting").length;
    expect(waitingCount).toBe(2);
  });
});

describe("agent-detection-service — split-chunk OSC detection", () => {
  it("detects an OSC 9 notification split across two PTY chunks", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 130 }]),
    ]);
    initAgentDetection();

    // First chunk ends mid-preamble; second chunk completes it.
    notifyOutputObservers(130, "\x1b]");
    notifyOutputObservers(130, "9;Claude Code: response ready\x07");

    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
    );
    expect(item?.label).toBe("waiting");
  });
});

describe("agent-detection-service — done status (S-DONE-IDLE)", () => {
  it("title change to 'ready' transitions agent status to 'done'", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 200 }]),
    ]);
    initAgentDetection();
    expect(getAgents()[0]?.status).toBe("idle");

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude — ready",
    });
    expect(getAgents()[0]?.status).toBe("done");
  });

  it("title change to 'done' transitions agent status to 'done'", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 201 }]),
    ]);
    initAgentDetection();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude — done",
    });
    expect(getAgents()[0]?.status).toBe("done");
  });

  it("done status writes a muted variant to the registry", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 202 }]),
    ]);
    initAgentDetection();

    eventBus.emit({
      type: "surface:titleChanged",
      id: "s1",
      oldTitle: "claude",
      newTitle: "claude — ready",
    });

    const item = get(statusRegistry.store).find(
      (i) => i.source === "_agent" && i.metadata?.surfaceId === "s1",
    );
    expect(item?.label).toBe("done");
    expect(item?.variant).toBe("muted");
  });

  it("idle timeout after 30s without a title match emits 'idle', not 'done'", () => {
    vi.useFakeTimers();
    try {
      nestedWorkspaces.set([
        makeNestedWorkspace("w1", [{ id: "s1", title: "claude", ptyId: 203 }]),
      ]);
      initAgentDetection();

      // Trigger running state (starts idle timer)
      eventBus.emit({
        type: "surface:titleChanged",
        id: "s1",
        oldTitle: "claude",
        newTitle: "claude working",
      });
      expect(getAgents()[0]?.status).toBe("running");

      // Let the 30s idle timeout fire
      vi.advanceTimersByTime(31_000);
      expect(getAgents()[0]?.status).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("agent-detection-service — lookup helpers", () => {
  it("getAgentByAgentId returns undefined for unknown id", () => {
    expect(getAgentByAgentId("nope")).toBeUndefined();
  });

  it("getAgentBySurfaceId returns undefined for unknown surface", () => {
    expect(getAgentBySurfaceId("nope")).toBeUndefined();
  });

  it("getAgentByAgentId finds a registered agent", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("ws1", [{ id: "s1", title: "claude", ptyId: 1 }]),
    ]);
    initAgentDetection();
    const agents = getAgents();
    expect(agents).toHaveLength(1);
    const found = getAgentByAgentId(agents[0].agentId);
    expect(found).toBeDefined();
    expect(found?.surfaceId).toBe("s1");
  });

  it("getAgentBySurfaceId finds a registered agent", () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("ws1", [{ id: "s1", title: "claude", ptyId: 1 }]),
    ]);
    initAgentDetection();
    const found = getAgentBySurfaceId("s1");
    expect(found).toBeDefined();
    expect(found?.workspaceId).toBe("ws1");
  });
});
