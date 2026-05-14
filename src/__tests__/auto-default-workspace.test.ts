/**
 * Auto-default Terminal workspace on first launch.
 *
 * Covers the new step 5 in restoreWorkspaces' resolution order:
 *   - state.workspaces === undefined AND no workspaces in store → inject "Terminal" at $HOME
 *   - state.workspaces === [] (explicit empty) → fall through to EmptySurface
 *   - Any existing workspace source (CLI, state, autoload) → no auto-default
 *
 * AC coverage: AC-1, AC-4, AC-5, AC-6-a, AC-6-b, AC-6-c, AC-6-d, AC-6-e
 * Finding coverage: F2 (getHome fallback), F4 (corrupt state.workspaces)
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
import canonicalFixture from "./__fixtures__/canonical-gnar-term-config.json";

const EMPTY_CLI: CliArgs = {
  path: null,
  working_directory: null,
  command: null,
  title: null,
  workspace: null,
  config: null,
  preview: null,
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

// ── F2: getHome() /tmp fallback is warned and not cached ──────────────────

describe("F2: getHome() /tmp fallback behavior", () => {
  it("F2: emits console.warn when Tauri get_home fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockedInvoke = vi.mocked(invoke);

    // First call: get_home fails; subsequent read_file also fails (no state).
    let callCount = 0;
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") {
        callCount++;
        throw new Error("Tauri bridge unavailable");
      }
      if (cmd === "read_file") throw new Error("no state file");
      throw new Error(`no mock for ${cmd}`);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    // Snapshot calls before restore (restore may clear the mock records).
    const warnCalls = [...warnSpy.mock.calls];
    warnSpy.mockRestore();

    // warn must have fired at least once and must mention getHome
    const homeWarn = warnCalls.find((args) =>
      String(args[0]).includes("getHome"),
    );
    expect(homeWarn).toBeDefined();
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("F2: transient failure does not cache /tmp — next call retries invoke", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockedInvoke = vi.mocked(invoke);

    // First get_home call fails; second succeeds with the real home dir.
    let getHomeCallCount = 0;
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_home") {
        getHomeCallCount++;
        if (getHomeCallCount === 1) throw new Error("transient failure");
        return MOCKED_HOME; // second call succeeds
      }
      if (cmd === "read_file") throw new Error("no state file");
      throw new Error(`no mock for ${cmd}`);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // First restoreWorkspaces call — get_home fails, falls back to /tmp
    await restoreWorkspaces({ ...EMPTY_CLI }, {});
    warnSpy.mockRestore();

    // At this point the cache must NOT hold /tmp. Reset store + signal to
    // allow a second restoreWorkspaces call.
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetRestoreSignal();
    // Do NOT call resetHomeForTests() — we're verifying the cache wasn't
    // poisoned by the /tmp fallback.

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    // Second call should have retried and gotten MOCKED_HOME.
    expect(getHomeCallCount).toBe(2);
    const list = get(workspaces);
    expect(list).toHaveLength(1);
    // The workspace cwd should reflect the real home, not /tmp.
    const ws = list[0];
    if (ws.paneLayout.type === "pane") {
      const surface = ws.paneLayout.pane.surfaces[0] as {
        kind: string;
        cwd?: string;
      };
      expect(surface.cwd).toBe(MOCKED_HOME);
    }
  });
});

// ── F4: corrupt state.workspaces triggers auto-default ────────────────────

describe("F4: corrupt state.workspaces values fall through to auto-default", () => {
  it("F4: state.workspaces is a string → warn fires + auto-default Terminal injected", async () => {
    await mockStateFile(JSON.stringify({ workspaces: "not-an-array" }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    // Snapshot calls before restore
    const warnCalls = [...warnSpy.mock.calls];
    warnSpy.mockRestore();

    // Auto-default must have fired
    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");

    // Warn must have mentioned the corruption
    const corruptWarn = warnCalls.find((args) =>
      String(args[0]).includes("unexpected type"),
    );
    expect(corruptWarn).toBeDefined();
  });

  it("F4: state.workspaces is a number → warn fires + auto-default Terminal injected", async () => {
    await mockStateFile(JSON.stringify({ workspaces: 42 }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const warnCalls = [...warnSpy.mock.calls];
    warnSpy.mockRestore();

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
    const corruptWarn = warnCalls.find((args) =>
      String(args[0]).includes("unexpected type"),
    );
    expect(corruptWarn).toBeDefined();
  });

  it("F4: state.workspaces is an object → warn fires + auto-default Terminal injected", async () => {
    await mockStateFile(
      JSON.stringify({ workspaces: { id: "ws-1", name: "broken" } }),
    );

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const warnCalls = [...warnSpy.mock.calls];
    warnSpy.mockRestore();

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
    const corruptWarn = warnCalls.find((args) =>
      String(args[0]).includes("unexpected type"),
    );
    expect(corruptWarn).toBeDefined();
  });

  it("F4: state.workspaces is null → warn fires + auto-default Terminal injected", async () => {
    // null is a JSON-valid value that is neither an array nor undefined.
    // Guards against a tempting "safer" refactor (e.g.
    // `typeof x === "object" && x !== null`) that would silently land users
    // on EmptySurface instead of auto-defaulting.
    await mockStateFile(JSON.stringify({ workspaces: null }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const warnCalls = [...warnSpy.mock.calls];
    warnSpy.mockRestore();

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Terminal");
    const corruptWarn = warnCalls.find((args) =>
      String(args[0]).includes("unexpected type"),
    );
    expect(corruptWarn).toBeDefined();
  });

  it("F4: state.workspaces is [] (explicit empty) → NO auto-default (user intent preserved)", async () => {
    // Ensure [] still falls through to EmptySurface — regression guard for F4 fix.
    await mockStateFile(JSON.stringify({ workspaces: [] }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreWorkspaces({ ...EMPTY_CLI }, {});

    const warnCalls = [...warnSpy.mock.calls];
    warnSpy.mockRestore();

    expect(get(workspaces)).toHaveLength(0);
    // No corruption warn should have fired
    const corruptWarn = warnCalls.find((args) =>
      String(args[0]).includes("unexpected type"),
    );
    expect(corruptWarn).toBeUndefined();
  });
});

// ── AC-6-b: canonical fixture drives restoreWorkspaces autoload ───────────

describe("AC-6-b: canonical fixture autoload through restoreWorkspaces", () => {
  it("AC-6-b: canonical fixture autoload populates workspaces, no auto-default Terminal injected", async () => {
    // State file missing → state.workspaces is undefined (first launch).
    await mockStateFile(null);

    await restoreWorkspaces(
      { ...EMPTY_CLI },
      canonicalFixture as GnarTermConfig,
    );

    const list = get(workspaces);

    // The fixture's autoload is ["gnar-term-dev"] — exactly one workspace.
    const autoloadNames = canonicalFixture.autoload;
    expect(list).toHaveLength(autoloadNames.length);

    // Each name in autoload must appear in the workspace store (in order).
    for (let i = 0; i < autoloadNames.length; i++) {
      // The workspace template name comes from the matching commands[].workspace.name.
      const cmdEntry = canonicalFixture.commands.find(
        (c) => c.name === autoloadNames[i],
      );
      const expectedName = cmdEntry?.workspace?.name ?? autoloadNames[i];
      expect(list[i]!.name).toBe(expectedName);
    }

    // No auto-default "Terminal" should have been injected since autoload populated the store.
    const terminalAutoDefault = list.find(
      (w) =>
        w.name === "Terminal" &&
        !autoloadNames.includes("Terminal") &&
        !autoloadNames.includes(w.name),
    );
    // Simpler: the store must match autoload exactly, not contain an extra Terminal.
    expect(list.map((w) => w.name)).toEqual(
      autoloadNames.map((name) => {
        const cmdEntry = canonicalFixture.commands.find((c) => c.name === name);
        return cmdEntry?.workspace?.name ?? name;
      }),
    );
    expect(terminalAutoDefault).toBeUndefined();
  });
});

// ── code-reviewer/medium: explicit-empty [] beats config.autoload ─────────

describe("explicit-empty state beats config.autoload (code-reviewer/medium)", () => {
  it("when state.workspaces === [] AND config.autoload is non-empty, explicit-empty wins — store stays empty, autoload does NOT fire", async () => {
    // state.json exists with explicit workspaces: [] — user deleted everything.
    await mockStateFile(JSON.stringify({ workspaces: [] }));

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

    // Explicit empty is the only valid "stay empty" sentinel.
    // Store must be empty — autoload must NOT have fired.
    expect(get(workspaces)).toHaveLength(0);
    expect(get(activeWorkspaceIdx)).toBe(-1);
  });
});
