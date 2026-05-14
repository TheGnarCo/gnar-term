/**
 * Auto-default Terminal workspace on first launch.
 *
 * Covers the new step 5 in restoreWorkspaces' resolution order:
 *   - state.workspaces === undefined AND no workspaces in store → inject "Terminal" at $HOME
 *   - state.workspaces === [] (explicit empty) → fall through to EmptySurface
 *   - Any existing workspace source (CLI, state, autoload) → no auto-default
 *
 * AC coverage: AC-1, AC-4, AC-5, AC-6-a, AC-6-c, AC-6-d, AC-6-e
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const MOCKED_HOME = "/home/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation(async (cmd: string) => {
    if (cmd === "get_home") return MOCKED_HOME;
    throw new Error(`no mock for ${cmd}`);
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Stub terminal-service so we don't spawn a real PTY. The real signature is
// createTerminalSurface(pane, cwd?, env?). We capture cwd onto the stub so
// assertions can inspect it.
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(
    async (pane: { surfaces: unknown[] }, cwd?: string) => {
      const stub = {
        kind: "terminal" as const,
        id: `t-${Math.random().toString(36).slice(2, 7)}`,
        title: "stub",
        ptyId: -1,
        hasUnread: false,
        opened: false,
        cwd,
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
import { resetHomeForTests } from "../lib/services/service-helpers";
import type { GnarTermConfig } from "../lib/config";

const EMPTY_CLI: CliArgs = {
  path: null,
  working_directory: null,
  command: null,
  title: null,
  workspace: null,
  config: null,
};

// Helper: configure the invoke mock for a specific state.json response.
async function mockStateFile(
  content: string | null,
): Promise<ReturnType<typeof vi.mocked>> {
  const { invoke } = await import("@tauri-apps/api/core");
  const mockedInvoke = vi.mocked(invoke);
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "get_home") return MOCKED_HOME;
    if (cmd === "read_file") {
      if (content === null) throw new Error("no state file");
      return content;
    }
    throw new Error(`no mock for ${cmd}`);
  });
  return mockedInvoke;
}

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  resetRestoreSignal();
  // Reset the getHome() cache so each test gets a fresh invoke call.
  resetHomeForTests();
});

describe("auto-default Terminal workspace", () => {
  it("AC-6-a + AC-1: no config, no state file → one workspace named Terminal, cwd matches $HOME, one terminal surface", async () => {
    // Default mock: get_home returns MOCKED_HOME, read_file throws (no state.json).
    await mockStateFile(null);

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");

    // Verify there is exactly one terminal surface with cwd = $HOME.
    const ws = list[0];
    expect(ws.paneLayout.type).toBe("pane");
    if (ws.paneLayout.type !== "pane") return;
    const surfaces = ws.paneLayout.pane.surfaces;
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0] as { kind: string; cwd?: string };
    expect(surface.kind).toBe("terminal");
    expect(surface.cwd).toBe(MOCKED_HOME);
  });

  it("AC-6-c: state.json missing entirely → auto-default fires", async () => {
    // read_file throws → loadState returns {} → state.workspaces === undefined.
    await mockStateFile(null);

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
  });

  it("AC-6-c (variant): state.json present but no workspaces field → auto-default fires", async () => {
    // state.json exists but contains no workspaces key → state.workspaces === undefined.
    await mockStateFile(JSON.stringify({ activeWorkspaceId: "some-id" }));

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
  });

  it("AC-6-d: CLI --workspace with matching config.commands entry → no auto-default Terminal injected", async () => {
    await mockStateFile(null);

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
    expect(list[0].name).not.toBe("Terminal");
  });

  it("AC-6-d (variant): CLI --path → workspace synthesized from path, no auto-default Terminal", async () => {
    await mockStateFile(null);

    await restoreWorkspaces(
      { ...EMPTY_CLI, path: "/Users/me/projects/myapp" },
      {},
    );

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("myapp");
    expect(list[0].name).not.toBe("Terminal");
  });

  it("AC-6-e + AC-5: state.json with workspaces: [] → store stays empty, no auto-default", async () => {
    // Explicit empty workspaces array = user deleted all workspaces on purpose.
    await mockStateFile(JSON.stringify({ workspaces: [] }));

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    expect(get(workspaces)).toHaveLength(0);
    expect(get(activeWorkspaceIdx)).toBe(-1);
  });

  it("AC-4: config.autoload non-empty resolving real workspace + no state → autoload wins, no Terminal auto-default", async () => {
    await mockStateFile(null);

    const config: GnarTermConfig = {
      autoload: ["alpha"],
      commands: [
        {
          name: "alpha",
          workspace: {
            name: "Alpha",
            layout: { pane: { surfaces: [{ type: "terminal" }] } },
          },
        },
      ],
    };

    await restoreWorkspaces({ ...EMPTY_CLI }, config);

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Alpha");
    expect(list[0].name).not.toBe("Terminal");
  });

  it("AC-4 (variant): state.workspaces non-empty array → restore wins, no auto-default Terminal", async () => {
    // Provide a persisted state with one workspace.
    const persistedState = {
      workspaces: [
        {
          id: "ws-1",
          name: "Saved Workspace",
          layout: { pane: { surfaces: [] } },
        },
      ],
    };
    await mockStateFile(JSON.stringify(persistedState));

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Saved Workspace");
    expect(list[0].name).not.toBe("Terminal");
  });

  it("AC-4 (variant — edge case): state.workspaces === undefined AND config.autoload set but named commands missing → autoload produces zero workspaces, first-launch → auto-default fires", async () => {
    // state.json missing → state.workspaces === undefined.
    // autoload references "ghost" which is not in config.commands → no workspace created.
    // Gate: store ended up empty + state.workspaces undefined → auto-default fires.
    await mockStateFile(null);

    const config: GnarTermConfig = {
      autoload: ["ghost"],
      commands: [
        {
          name: "other",
          workspace: {
            name: "Other",
            layout: { pane: { surfaces: [] } },
          },
        },
      ],
    };

    await restoreWorkspaces({ ...EMPTY_CLI }, config);

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
  });
});
