/**
 * Regression test for commit 497a691 — git branch bleeding across workspaces.
 *
 * Scenario: user rapidly switches workspace A → B. The async getActiveCwd
 * for A is still in flight when workspace:activated fires for B. Without the
 * re-verification in ensurePolling, A's resolved CWD could get assigned to
 * B (or polling could start for a no-longer-active workspace), causing the
 * sidebar to show B's branch for A or vice versa.
 *
 * The fix (git-status/index.ts ensurePolling) re-checks activeWorkspaceId
 * after the getActiveCwd await, bailing out if the user has switched since
 * the call began.
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
            ptyId: id === "A" ? 1 : 2,
            cwd,
            terminal: { dispose: vi.fn(), focus: vi.fn() },
          },
        ],
      },
    },
  } as unknown as Workspace;
}

describe("git-status ensurePolling CWD-race resilience (497a691)", () => {
  beforeEach(async () => {
    await resetExtensions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  afterEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("does not cross-assign workspace A's cwd to workspace B on rapid activation switch", async () => {
    // Two workspaces with DIFFERENT cwds — the whole point of the test is
    // that branch lookups for each must hit the correct cwd.
    workspaces.set([
      makeWs("A", "surf-A", "/repos/project-A"),
      makeWs("B", "surf-B", "/repos/project-B"),
    ]);
    activeWorkspaceIdx.set(0);

    const runScriptCalls: Array<{ cwd?: string; command?: string }> = [];
    const tauri = await import("@tauri-apps/api/core");
    const invokeMock = vi.mocked(tauri.invoke);
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_home") return "/Users/x";
      if (cmd === "get_pty_cwd") {
        const a = args as { ptyId?: number };
        return a.ptyId === 1 ? "/repos/project-A" : "/repos/project-B";
      }
      if (cmd === "run_script") {
        const a = args as { cwd?: string; command?: string };
        runScriptCalls.push({ cwd: a.cwd, command: a.command });
        if (a.command?.includes("echo $HOME")) {
          return { stdout: "/Users/x\n", stderr: "", exit_code: 0 };
        }
        if (a.command?.includes("rev-parse --show-toplevel")) {
          // Echo the cwd back so the test can see which cwd was used.
          return { stdout: `${a.cwd}\n`, stderr: "", exit_code: 0 };
        }
        if (a.command?.includes("status --porcelain=v1 -b")) {
          // Branch name encodes the cwd so the resulting status item's label
          // reveals any mis-binding.
          const branch = a.cwd?.includes("project-A") ? "branch-A" : "branch-B";
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

    // Simulate: user activates A, then almost immediately switches to B.
    eventBus.emit({ type: "workspace:activated", id: "A", previousId: null });
    // Flip active index BEFORE A's resolution completes — this is the race.
    activeWorkspaceIdx.set(1);
    eventBus.emit({ type: "workspace:activated", id: "B", previousId: "A" });

    // Drain microtasks so both ensurePolling chains resolve.
    for (let i = 0; i < 50; i++) await Promise.resolve();

    const items = get(statusRegistry.store);
    const branchA = items.find(
      (i) =>
        i.source === "git-status" &&
        i.workspaceId === "A" &&
        i.id.endsWith(":branch"),
    );
    const branchB = items.find(
      (i) =>
        i.source === "git-status" &&
        i.workspaceId === "B" &&
        i.id.endsWith(":branch"),
    );

    // The invariant: if a branch item exists for workspace A, it must be
    // "branch-A"; if one exists for B, it must be "branch-B". The bug was
    // that B would get labeled "branch-A" (or neither would be correct)
    // because A's async cwd resolution leaked into B's slot.
    if (branchA) expect(branchA.label).toBe("branch-A");
    if (branchB) expect(branchB.label).toBe("branch-B");

    // And at least B (the final active workspace) must have its correct
    // branch — the fix must not *prevent* B from polling.
    expect(branchB).toBeDefined();
    expect(branchB!.label).toBe("branch-B");
  });
});
