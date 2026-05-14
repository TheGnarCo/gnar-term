/**
 * restoreWorkspaces — CLI-driven happy paths.
 *
 * Existing tests only cover the *skip* cases (e.g. pty-close must not
 * spawn a fresh workspace). This file asserts the positive end-to-end
 * shape: given a CliArgs payload, restoreWorkspaces produces the right
 * workspace in the store with the expected fields and the expected
 * active selection.
 *
 * Branches covered:
 *   1. --path  → synthesizes a workspace named after the trailing dir
 *   2. --workspace <name>      → resolves config.commands[name].workspace
 *   3. --workspace <unknown>   → warns and leaves the store empty
 *                                 (no naked fallback workspace)
 *   4. --command "<cmd>"       → terminal surface carries `command`
 *   5. autoload list           → opens every named workspace
 *   6. no args, no state, no autoload → auto-defaults a Terminal workspace
 *      at $HOME (state.workspaces === undefined = first launch)
 *   7. state.workspaces === [] (explicit empty) → store stays empty so
 *      App.svelte renders <EmptySurface />.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no state")),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Stub terminal-service so we don't try to spawn a real PTY. The runtime
// service calls createTerminalSurface synchronously when hydrating a
// terminal-typed surface def; we capture the def into a fake surface so
// downstream assertions can read e.g. `command`.
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(
    async (
      pane: { surfaces: unknown[] },
      _opts: unknown,
      def?: { command?: string; cwd?: string },
    ) => {
      const stub = {
        kind: "terminal" as const,
        id: `t-${Math.random().toString(36).slice(2, 7)}`,
        title: "stub",
        ptyId: -1,
        hasUnread: false,
        opened: false,
        cwd: def?.cwd,
        definedCommand: def?.command,
        // safeFocus walks `s.terminal.focus()` post-restore — give it a
        // no-op so the unhandled-rejection check stays clean.
        terminal: { focus: () => {} },
      };
      pane.surfaces.push(stub);
      return stub;
    },
  ),
}));

import {
  restoreWorkspaces,
  resetRestoreSignal,
  type CliArgs,
} from "../lib/bootstrap/restore-workspaces";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import type { GnarTermConfig } from "../lib/config";

const EMPTY_CLI: CliArgs = {
  path: null,
  working_directory: null,
  command: null,
  title: null,
  workspace: null,
  config: null,
  preview: null,
};

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  resetRestoreSignal();
});

describe("restoreWorkspaces — CLI-driven creation", () => {
  it("--path synthesizes a workspace named after the trailing path component", async () => {
    await restoreWorkspaces(
      { ...EMPTY_CLI, path: "/Users/me/Code/myproject" },
      {},
    );

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("myproject");
  });

  it("--working-directory falls through the same code path as --path", async () => {
    await restoreWorkspaces(
      { ...EMPTY_CLI, working_directory: "/srv/svc" },
      {},
    );

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("svc");
  });

  it("--title overrides the path-derived workspace name", async () => {
    await restoreWorkspaces(
      { ...EMPTY_CLI, path: "/srv/svc", title: "Custom Name" },
      {},
    );

    const list = get(workspaces);
    expect(list[0].name).toBe("Custom Name");
  });

  it("--command spawns a workspace whose terminal surface carries that command", async () => {
    await restoreWorkspaces(
      { ...EMPTY_CLI, path: "/srv/svc", command: "ls -la" },
      {},
    );

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    const ws = list[0];
    expect(ws.paneLayout.type).toBe("pane");
    if (ws.paneLayout.type !== "pane") return;
    const surface = ws.paneLayout.pane.surfaces[0] as {
      kind: string;
      definedCommand?: string;
    };
    expect(surface.kind).toBe("terminal");
    expect(surface.definedCommand).toBe("ls -la");
  });

  it("--workspace <name> resolves to the named workspace template in config.commands", async () => {
    const config: GnarTermConfig = {
      commands: [
        {
          name: "dev",
          workspace: {
            name: "Dev Stack",
            layout: { pane: { surfaces: [{ type: "terminal" }] } },
          },
        },
      ],
    };

    await restoreWorkspaces({ ...EMPTY_CLI, workspace: "dev" }, config);

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Dev Stack");
  });

  it("--workspace <unknown> warns and leaves the store empty", async () => {
    const config: GnarTermConfig = {
      commands: [
        {
          name: "dev",
          workspace: {
            name: "Dev Stack",
            layout: { pane: { surfaces: [{ type: "terminal" }] } },
          },
        },
      ],
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI, workspace: "missing" }, config);

    expect(get(workspaces)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Workspace "missing" not found'),
    );
    warnSpy.mockRestore();
  });

  it("autoload opens every named workspace in order when no other args drive selection", async () => {
    const config: GnarTermConfig = {
      autoload: ["alpha", "beta"],
      commands: [
        {
          name: "alpha",
          workspace: {
            name: "Alpha",
            layout: { pane: { surfaces: [] } },
          },
        },
        {
          name: "beta",
          workspace: {
            name: "Beta",
            layout: { pane: { surfaces: [] } },
          },
        },
      ],
    };

    await restoreWorkspaces({ ...EMPTY_CLI }, config);

    const names = get(workspaces).map((w) => w.name);
    expect(names).toEqual(["Alpha", "Beta"]);
  });

  it("no args + no state + no autoload auto-defaults a Terminal workspace at $HOME (AC-6-a)", async () => {
    // invoke is mocked to reject for all calls (including get_home → falls back to /tmp).
    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
  });

  it("state.workspaces === [] (explicit empty) leaves the store empty for EmptySurface (AC-6-e)", async () => {
    // Override invoke to return a state.json with an explicit empty workspaces array.
    const { invoke } = await import("@tauri-apps/api/core");
    const mockedInvoke = vi.mocked(invoke);
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "read_file") return JSON.stringify({ workspaces: [] });
      throw new Error("no state");
    });

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    expect(get(workspaces)).toHaveLength(0);
    expect(get(activeWorkspaceIdx)).toBe(-1);

    // Restore default mock for subsequent tests.
    mockedInvoke.mockRejectedValue(new Error("no state"));
  });
});
