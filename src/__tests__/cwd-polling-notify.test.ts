/**
 * Regression test: `startCwdPolling` must notify the `workspaces` store
 * whenever a surface's cwd changes, not only when the title also
 * changed. Without this, sidebar subscribers (e.g. the core git status
 * service) never see the user's `cd` and keep showing the original cwd.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `asset://${p}`,
  Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import type { Workspace } from "../lib/types";
import { startCwdPolling } from "../lib/terminal-service";

function makeWs(id: string, surfaceId: string, cwd: string): Workspace {
  return {
    id,
    name: id,
    activePaneId: `pane-${id}`,
    splitRoot: {
      type: "pane",
      pane: {
        id: `pane-${id}`,
        activeSurfaceId: surfaceId,
        surfaces: [
          {
            id: surfaceId,
            kind: "terminal",
            title: "custom-title",
            ptyId: 1,
            cwd,
            terminal: { dispose: vi.fn(), focus: vi.fn() },
          },
        ],
      },
    },
  } as unknown as Workspace;
}

describe("startCwdPolling notifies the workspaces store on cwd change", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  afterEach(() => {
    vi.useRealTimers();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("fires workspaces.update when pty cwd differs from cached cwd, even if title is preserved", async () => {
    const ws = makeWs("A", "surf-A", "/repos/project-A");
    workspaces.set([ws]);

    let ptyCwd = "/repos/project-A";
    const tauri = await import("@tauri-apps/api/core");
    vi.mocked(tauri.invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_pty_cwd") return ptyCwd;
      return undefined;
    });

    let updateCount = 0;
    const unsub = workspaces.subscribe(() => {
      updateCount++;
    });
    // Initial subscribe fires once — reset counter so we only count
    // updates caused by the poll.
    const baseline = updateCount;

    startCwdPolling();

    // User cd's.
    ptyCwd = "/repos/project-B";

    // Advance past the 5000ms poll interval. Drain microtasks after
    // each advance so the async get_pty_cwd resolves.
    await vi.advanceTimersByTimeAsync(5100);
    for (let i = 0; i < 50; i++) await Promise.resolve();

    expect(updateCount).toBeGreaterThan(baseline);

    // The surface's cwd is now the new path.
    const current = get(workspaces);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const surface = (current[0]!.splitRoot as any).pane.surfaces[0];
    expect(surface.cwd).toBe("/repos/project-B");
    // Custom title is preserved (title doesn't start with "Shell ").
    expect(surface.title).toBe("custom-title");

    unsub();
  });
});
