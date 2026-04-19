/**
 * H4 regression — on git command failure, branch/dirty items must be cleared
 * rather than left stale. The extension previously early-returned on null
 * runWithTimeout results, leaving the last-successful branch name and dirty
 * count rendered indefinitely even after the repo disappeared or git hung.
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

type ScriptResult = { stdout: string; stderr: string; exit_code: number };

describe("git-status stale-data clear (H4)", () => {
  beforeEach(async () => {
    await resetExtensions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    // Wipe any leftover registry items from prior tests.
    statusRegistry.reset();
  });

  afterEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    statusRegistry.reset();
  });

  it("clears branch+dirty items when git status fails after a successful fetch", async () => {
    vi.useFakeTimers();
    try {
      // Prepare the workspace store with a terminal so getActiveCwd has state.
      workspaces.set([
        {
          id: "ws-fail",
          name: "Fail",
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
                  title: "zsh",
                  ptyId: 1,
                  cwd: "/tmp/repo",
                  terminal: { dispose: vi.fn(), focus: vi.fn() },
                },
              ],
            },
          },
        },
      ] as unknown as Workspace[]);
      activeWorkspaceIdx.set(0);

      // First call path: git succeeds — seeds branch + dirty items.
      const okResponses: Record<string, ScriptResult | null> = {
        "echo $HOME": { stdout: "/Users/x\n", stderr: "", exit_code: 0 },
        "rev-parse --show-toplevel": {
          stdout: "/tmp/repo\n",
          stderr: "",
          exit_code: 0,
        },
        "status --porcelain=v1 -b": {
          stdout: "## main...origin/main\n M file.ts\n",
          stderr: "",
          exit_code: 0,
        },
        "rev-parse --abbrev-ref HEAD": {
          stdout: "main\n",
          stderr: "",
          exit_code: 0,
        },
        "gh pr view": { stdout: "{}", stderr: "", exit_code: 1 }, // no PR
      };

      // Register the extension with a custom api.invoke mock.
      // Rather than mock the full extension-api machinery, we use the real
      // extension loader and override the run_script dispatcher via the
      // tauri invoke mock.
      const tauri = await import("@tauri-apps/api/core");
      const invokeMock = vi.mocked(tauri.invoke);
      invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return "/Users/x";
        if (cmd === "run_script") {
          const a = args as { command?: string };
          const key = Object.keys(okResponses).find((k) =>
            a?.command?.includes(k),
          );
          if (!key) return null;
          const val = okResponses[key];
          if (val === null) throw new Error("failure");
          return val;
        }
        return undefined;
      });

      registerExtension(gitStatusManifest, registerGitStatusExtension);
      await activateExtension("git-status");

      // Activate a workspace — triggers ensurePolling → refreshGitStatus.
      eventBus.emit({
        type: "workspace:activated",
        id: "ws-fail",
        previousId: null,
      });

      // Flush the microtask chain kicked off by ensurePolling + initial
      // refresh without advancing the polling setInterval timers.
      for (let i = 0; i < 20; i++) await Promise.resolve();

      const itemsAfterSuccess = get(statusRegistry.store);
      expect(
        itemsAfterSuccess.some(
          (i) =>
            i.source === "git-status" &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":branch"),
        ),
      ).toBe(true);
      expect(
        itemsAfterSuccess.some(
          (i) =>
            i.source === "git-status" &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":dirty"),
        ),
      ).toBe(true);

      // Now flip run_script to fail for `git status`. The bug-before-fix
      // leaves the earlier branch+dirty items in place.
      invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return "/Users/x";
        if (cmd === "run_script") {
          const a = args as { command?: string };
          if (a?.command?.includes("rev-parse --show-toplevel")) {
            return {
              stdout: "/tmp/repo\n",
              stderr: "",
              exit_code: 0,
            };
          }
          // Everything else (status, branch, pr) fails.
          return null;
        }
        return undefined;
      });

      // Trigger another refresh via the 30s polling interval. The old
      // test used the surface:titleChanged debounced path, which was
      // dead code (no emitter) and has been removed. The polling
      // interval is the authoritative refresh trigger for active
      // workspaces.
      await vi.advanceTimersByTimeAsync(30_100);
      for (let i = 0; i < 20; i++) await Promise.resolve();

      const itemsAfterFail = get(statusRegistry.store);
      expect(
        itemsAfterFail.some(
          (i) =>
            i.source === "git-status" &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":branch"),
        ),
      ).toBe(false);
      expect(
        itemsAfterFail.some(
          (i) =>
            i.source === "git-status" &&
            i.workspaceId === "ws-fail" &&
            i.id.endsWith(":dirty"),
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
