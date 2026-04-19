/**
 * Regression test: git-status must refresh its branch/dirty/cwd items
 * when the active workspace's cwd changes (user `cd`s in the terminal).
 *
 * Prior bug: git-status cached the cwd at first poll and the polling
 * interval captured it in closure. When the user cd'd to a different
 * directory, the sidebar continued showing branch/dirty for the OLD
 * cwd. The subscribed `surface:titleChanged` event was also never
 * emitted anywhere, so the debounced handler was dead code.
 *
 * The fix: subscribe to `api.workspaces`; when the store fires an
 * update, re-resolve the active workspace's cwd via `getActiveCwd` and,
 * if it differs from the cached cwd, refresh with the new value.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { gitStatusManifest, registerGitStatusExtension } from "..";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import { statusRegistry } from "../../../lib/services/status-registry";
import { eventBus } from "../../../lib/services/event-bus";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";
import type { Workspace } from "../../../lib/types";

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
            title: "zsh",
            ptyId: 1,
            cwd,
            terminal: { dispose: vi.fn(), focus: vi.fn() },
          },
        ],
      },
    },
  } as unknown as Workspace;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe("git-status refreshes when the active workspace's cwd changes", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await resetExtensions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("re-runs git status with the NEW cwd after the store fires an update", async () => {
    const ws = makeWs("A", "surf-A", "/repos/project-A");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    let ptyCwd = "/repos/project-A";
    const runScriptCalls: Array<{ cwd?: string; command?: string }> = [];
    const tauri = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(tauri.invoke);
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_home") return "/Users/x";
      if (cmd === "get_pty_cwd") return ptyCwd;
      if (cmd === "run_script") {
        const a = args as { cwd?: string; command?: string };
        runScriptCalls.push({ cwd: a.cwd, command: a.command });
        if (a.command?.includes("echo $HOME")) {
          return { stdout: "/Users/x\n", stderr: "", exit_code: 0 };
        }
        if (a.command?.includes("rev-parse --show-toplevel")) {
          return { stdout: `${a.cwd}\n`, stderr: "", exit_code: 0 };
        }
        if (a.command?.includes("status --porcelain=v1 -b")) {
          // Branch name encodes the cwd so we can trace which path was used.
          const branch = a.cwd?.includes("project-A")
            ? "branch-A"
            : a.cwd?.includes("project-B")
              ? "branch-B"
              : "branch-unknown";
          return {
            stdout: `## ${branch}...origin/main\n`,
            stderr: "",
            exit_code: 0,
          };
        }
        if (a.command?.includes("rev-parse --abbrev-ref HEAD")) {
          const branch = a.cwd?.includes("project-A") ? "branch-A" : "branch-B";
          return { stdout: `${branch}\n`, stderr: "", exit_code: 0 };
        }
        return { stdout: "", stderr: "", exit_code: 1 };
      }
      return undefined;
    });

    registerExtension(gitStatusManifest, registerGitStatusExtension);
    await activateExtension("git-status");

    // First activation — ensurePolling kicks in with the initial cwd.
    eventBus.emit({ type: "workspace:activated", id: "A", previousId: null });
    await drain();

    // Initial run should have gone to project-A.
    const initialStatus = runScriptCalls.find((c) =>
      c.command?.includes("status --porcelain=v1 -b"),
    );
    expect(initialStatus?.cwd).toContain("project-A");
    const initialItems = get(statusRegistry.store);
    expect(
      initialItems.find(
        (i) => i.workspaceId === "A" && i.id.endsWith(":branch"),
      )?.label,
    ).toBe("branch-A");

    // User cd's: the PTY cwd changes and the surface's cached cwd is
    // updated by terminal-service. Then the store fires an update to
    // notify subscribers.
    ptyCwd = "/repos/project-B";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ws.splitRoot as any).pane.surfaces[0].cwd = "/repos/project-B";
    workspaces.update((l) => [...l]);

    // Advance past the debounce window in the store-subscription handler.
    await vi.advanceTimersByTimeAsync(600);
    await drain();

    // A git status should now have been re-run against the NEW cwd.
    const statusRunsAgainstB = runScriptCalls.filter(
      (c) =>
        c.command?.includes("status --porcelain=v1 -b") &&
        c.cwd?.includes("project-B"),
    );
    expect(statusRunsAgainstB.length).toBeGreaterThan(0);

    // Sidebar branch item should reflect the new cwd.
    const finalItems = get(statusRegistry.store);
    const branchItem = finalItems.find(
      (i) => i.workspaceId === "A" && i.id.endsWith(":branch"),
    );
    expect(branchItem?.label).toBe("branch-B");
  });
});
