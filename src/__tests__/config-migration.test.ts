/**
 * Schema migration for configs written by older (origin/main-era) gnar-term
 * builds. Both the main and dev release builds read `~/.config/gnar-term/`,
 * so dev must accept main's on-disk shape without losing or silently
 * misinterpreting fields.
 *
 * Covered today:
 *   - SurfaceDef.type "markdown" (main) → "preview" (dev). Same `path`
 *     field, so the rest of the def survives.
 *   - Config path policy: gnar-term.json is canonical write target across
 *     project and global scopes, with legacy formats migrating on next save.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  loadConfig,
  saveConfig,
  migrateLoadedConfig,
  resetConfigStateForTests,
  type GnarTermConfig,
  type LayoutNode,
} from "../lib/config";
import canonicalFixture from "./__fixtures__/canonical-gnar-term-config.json";

describe("migrateLoadedConfig", () => {
  it("returns an empty config for non-object input", () => {
    expect(migrateLoadedConfig(null)).toEqual({});
    expect(migrateLoadedConfig(undefined)).toEqual({});
    expect(migrateLoadedConfig("string")).toEqual({});
  });

  it("rewrites legacy markdown surface type to preview in command layouts", () => {
    const main = {
      commands: [
        {
          name: "open notes",
          workspace: {
            name: "Notes",
            layout: {
              pane: {
                surfaces: [
                  // Legacy main shape: type was "markdown" with a path.
                  { type: "markdown", path: "/notes.md" },
                ],
              },
            },
          },
        },
      ],
    };

    const migrated = migrateLoadedConfig(main);
    const layout = migrated.commands![0]!.workspace!.layout as LayoutNode;
    if (!("pane" in layout)) throw new Error("expected pane node");
    expect(layout.pane.surfaces[0]!.type).toBe("preview");
    expect(layout.pane.surfaces[0]!.path).toBe("/notes.md");
  });

  it("recurses through split nodes", () => {
    const cfg = {
      commands: [
        {
          name: "split",
          workspace: {
            layout: {
              direction: "horizontal" as const,
              children: [
                {
                  pane: {
                    surfaces: [{ type: "markdown", path: "/a.md" }],
                  },
                },
                {
                  pane: {
                    surfaces: [
                      { type: "terminal" },
                      { type: "markdown", path: "/b.md" },
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const migrated = migrateLoadedConfig(cfg);
    const layout = migrated.commands![0]!.workspace!.layout as LayoutNode;
    if ("pane" in layout) throw new Error("expected split node");
    const left = layout.children[0];
    const right = layout.children[1];
    if (!("pane" in left) || !("pane" in right)) {
      throw new Error("expected pane children");
    }
    expect(left.pane.surfaces[0]!.type).toBe("preview");
    expect(right.pane.surfaces[0]!.type).toBe("terminal");
    expect(right.pane.surfaces[1]!.type).toBe("preview");
  });

  it("leaves non-markdown surface types untouched", () => {
    const cfg: GnarTermConfig = {
      commands: [
        {
          name: "term",
          workspace: {
            layout: {
              pane: {
                surfaces: [
                  { type: "terminal", command: "vim" },
                  { type: "browser", url: "https://example.com" },
                  { type: "preview", path: "/x.md" },
                ],
              },
            },
          },
        },
      ],
    };

    const migrated = migrateLoadedConfig(cfg);
    const layout = migrated.commands![0]!.workspace!.layout as LayoutNode;
    if (!("pane" in layout)) throw new Error("expected pane node");
    expect(layout.pane.surfaces.map((s) => s.type)).toEqual([
      "terminal",
      "browser",
      "preview",
    ]);
  });

  it("tolerates dropped main fields (opacity) without throwing", () => {
    const cfg = {
      theme: "dark",
      fontSize: 14,
      opacity: 0.9, // dropped in dev
      commands: [],
    };
    const migrated = migrateLoadedConfig(cfg);
    expect(migrated.theme).toBe("dark");
    expect(migrated.fontSize).toBe(14);
    // Dropped fields survive the migration as-is — TS just doesn't see them.
    expect((migrated as Record<string, unknown>).opacity).toBe(0.9);
  });

  it("handles configs with no commands array", () => {
    const cfg = { theme: "light" };
    const migrated = migrateLoadedConfig(cfg);
    expect(migrated.theme).toBe("light");
  });
});

describe("loadConfig — config path policy (gnar-term.json canonical)", () => {
  const HOME = "/home/test";
  const CONFIG_DIR = `${HOME}/.config/gnar-term`;

  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    const { resetConfigDirForTests } =
      await import("../lib/services/service-helpers");
    resetConfigDirForTests();
    resetConfigStateForTests();
  });

  function mockFileSystem(files: Record<string, string>) {
    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return HOME;
        if (cmd === "get_global_config_dir") return CONFIG_DIR;
        if (cmd === "ensure_dir") return null;
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (files[path] !== undefined) return files[path];
          throw new Error(`ENOENT: ${path}`);
        }
        if (cmd === "write_file") return null;
        return null;
      },
    );
  }

  // ── AC-2: canonical path policy ───────────────────────────────────────

  it("AC-2: loadConfig reads ./gnar-term.json as canonical (no write-forward)", async () => {
    mockFileSystem({
      "gnar-term.json": JSON.stringify({ theme: "project-theme" }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("project-theme");

    await saveConfig({});
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    // Canonical — next save stays at gnar-term.json
    expect(writes).toContain("gnar-term.json");
  });

  it("AC-2: loadConfig defaults _configPath to configDir/gnar-term.json when no source found", async () => {
    // All reads fail
    mockFileSystem({});
    await loadConfig();
    await saveConfig({ theme: "x" });

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain(`${CONFIG_DIR}/gnar-term.json`);
  });

  // ── AC-3: canonical fixture round-trip ─────────────────────────────────

  it("AC-3: canonical fixture loads without throwing", async () => {
    mockFileSystem({
      "gnar-term.json": JSON.stringify(canonicalFixture),
    });
    const cfg = await loadConfig();
    // All expected top-level keys must be present
    expect(cfg.theme).toBeDefined();
    expect(cfg.autoload).toBeDefined();
    expect(cfg.commands).toBeDefined();
    expect(cfg.fontSize).toBeDefined();
    expect(cfg.fontFamily).toBeDefined();
    expect((cfg as Record<string, unknown>).opacity).toBeDefined();
    expect(cfg.extensions).toBeDefined();
  });

  it("AC-6-f: canonical fixture round-trips through save preserving every top-level key", async () => {
    const fixtureJson = JSON.stringify(canonicalFixture);
    mockFileSystem({
      "gnar-term.json": fixtureJson,
    });
    await loadConfig();
    await saveConfig({});

    const writeCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file");
    expect(writeCalls.length).toBeGreaterThan(0);

    const lastWrite = writeCalls[writeCalls.length - 1]!;
    const written = JSON.parse(
      (lastWrite[1] as { content: string }).content,
    ) as Record<string, unknown>;

    // Every top-level key from the fixture must survive
    expect(written.theme).toBe(canonicalFixture.theme);
    expect(written.autoload).toEqual(canonicalFixture.autoload);
    expect(written.fontSize).toBe(canonicalFixture.fontSize);
    expect(written.fontFamily).toBe(canonicalFixture.fontFamily);
    expect(written.extensions).toEqual(canonicalFixture.extensions);
    // commands array — deep match
    expect(written.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: canonicalFixture.commands[0]!.name }),
      ]),
    );
    // opacity round-trips even though it's a dropped field
    expect((written as Record<string, unknown>).opacity).toBe(
      canonicalFixture.opacity,
    );
  });

  it("AC-6-g: second save after load → save → reload → save produces byte-identical output (idempotency)", async () => {
    const fixtureJson = JSON.stringify(canonicalFixture);
    let capturedWrite: string | undefined;

    // First pass: load then save — capture the first save output.
    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return HOME;
        if (cmd === "get_global_config_dir") return CONFIG_DIR;
        if (cmd === "ensure_dir") return null;
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (path === "gnar-term.json") return fixtureJson;
          throw new Error(`ENOENT: ${path}`);
        }
        if (cmd === "write_file") {
          capturedWrite = (args as { content: string }).content;
          return null;
        }
        return null;
      },
    );

    await loadConfig();
    await saveConfig({});
    const firstSave = capturedWrite!;
    expect(firstSave).toBeDefined();

    // Second pass: reload the first-save output, then save again.
    resetConfigStateForTests();
    const { resetConfigDirForTests } =
      await import("../lib/services/service-helpers");
    resetConfigDirForTests();

    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return HOME;
        if (cmd === "get_global_config_dir") return CONFIG_DIR;
        if (cmd === "ensure_dir") return null;
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (path === "gnar-term.json") return firstSave;
          throw new Error(`ENOENT: ${path}`);
        }
        if (cmd === "write_file") {
          capturedWrite = (args as { content: string }).content;
          return null;
        }
        return null;
      },
    );

    await loadConfig();
    await saveConfig({});
    const secondSave = capturedWrite!;

    expect(secondSave).toBe(firstSave);
  });

  it("AC-6-h: all canonical fixture top-level keys survive round-trip (enumerated, not Object.keys)", async () => {
    const fixtureJson = JSON.stringify(canonicalFixture);
    mockFileSystem({
      "gnar-term.json": fixtureJson,
    });
    await loadConfig();
    await saveConfig({});

    const writeCalls = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file");
    expect(writeCalls.length).toBeGreaterThan(0);

    const lastWrite = writeCalls[writeCalls.length - 1]!;
    const written = JSON.parse(
      (lastWrite[1] as { content: string }).content,
    ) as Record<string, unknown>;

    // Enumerate each expected top-level key explicitly so a regression that
    // silently drops any key is caught even without a dedicated test for it.
    expect(written.theme).toBe(canonicalFixture.theme);
    expect(written.autoload).toEqual(canonicalFixture.autoload);
    expect(written.commands).toBeDefined();
    expect(Array.isArray(written.commands)).toBe(true);
    expect((written.commands as unknown[]).length).toBe(
      canonicalFixture.commands.length,
    );
    expect(written.fontSize).toBe(canonicalFixture.fontSize);
    expect(written.fontFamily).toBe(canonicalFixture.fontFamily);
    // opacity is a dropped field in dev but must survive the round-trip
    expect((written as Record<string, unknown>).opacity).toBe(
      canonicalFixture.opacity,
    );
    expect(written.extensions).toEqual(canonicalFixture.extensions);
  });

  // ── AC-6 (g): one-shot migration — cmux.json ───────────────────────────

  it("AC-6 (g): one-shot migration — ./cmux.json read → next save writes ./gnar-term.json", async () => {
    mockFileSystem({
      "cmux.json": JSON.stringify({ theme: "cmux-project" }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("cmux-project");

    await saveConfig({});
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain("gnar-term.json");
    expect(writes).not.toContain("cmux.json");
  });

  it("AC-6 (g): one-shot migration — ~/.config/cmux/cmux.json read → next save writes configDir/gnar-term.json", async () => {
    mockFileSystem({
      [`${HOME}/.config/cmux/cmux.json`]: JSON.stringify({
        theme: "global-cmux",
      }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("global-cmux");

    await saveConfig({});
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain(`${CONFIG_DIR}/gnar-term.json`);
    expect(writes).not.toContain(`${HOME}/.config/cmux/cmux.json`);
  });

  it("AC-6 (g): one-shot migration — configDir/cmux.json read → next save writes configDir/gnar-term.json", async () => {
    mockFileSystem({
      [`${CONFIG_DIR}/cmux.json`]: JSON.stringify({
        theme: "configdir-cmux",
      }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("configdir-cmux");

    await saveConfig({});
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain(`${CONFIG_DIR}/gnar-term.json`);
    expect(writes).not.toContain(`${CONFIG_DIR}/cmux.json`);
  });

  // ── AC-6 (h): one-shot migration — .gnar-term ─────────────────────────

  it("AC-6 (h): one-shot migration — ./.gnar-term read → next save writes ./gnar-term.json", async () => {
    mockFileSystem({
      ".gnar-term": JSON.stringify({ theme: "dotfile-theme" }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("dotfile-theme");

    await saveConfig({});
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain("gnar-term.json");
    expect(writes).not.toContain(".gnar-term");
  });

  // ── Additional coverage: global canonical path ──────────────────────────

  it("reads from global gnar-term.json and stays at gnar-term.json (no write-forward)", async () => {
    mockFileSystem({
      [`${CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
        theme: "global-canonical",
      }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("global-canonical");

    await saveConfig({});
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain(`${CONFIG_DIR}/gnar-term.json`);
  });

  it("per-project gnar-term.json takes priority over global gnar-term.json", async () => {
    mockFileSystem({
      "gnar-term.json": JSON.stringify({ theme: "project-wins" }),
      [`${CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
        theme: "global-loses",
      }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("project-wins");
  });
});

describe("loadConfig — debug builds fall back to prod config dir", () => {
  const HOME = "/home/test";
  const DEV_CONFIG_DIR = `${HOME}/.config/gnar-term-dev`;
  const PROD_CONFIG_DIR = `${HOME}/.config/gnar-term`;

  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    const { resetConfigDirForTests, resetIsDebugBuildForTests } =
      await import("../lib/services/service-helpers");
    resetConfigDirForTests();
    resetIsDebugBuildForTests();
    resetConfigStateForTests();
  });

  function mockEnv(opts: {
    debug: boolean;
    configDir: string;
    files: Record<string, string>;
  }) {
    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return HOME;
        if (cmd === "get_global_config_dir") return opts.configDir;
        if (cmd === "is_debug_build") return opts.debug;
        if (cmd === "ensure_dir") return null;
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (opts.files[path] !== undefined) return opts.files[path];
          throw new Error(`ENOENT: ${path}`);
        }
        if (cmd === "write_file") return null;
        return null;
      },
    );
  }

  it("debug build with empty dev dir loads prod gnar-term.json", async () => {
    mockEnv({
      debug: true,
      configDir: DEV_CONFIG_DIR,
      files: {
        [`${PROD_CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
          theme: "prod-theme",
          autoload: ["prod-ws"],
        }),
      },
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("prod-theme");
    expect(cfg.autoload).toEqual(["prod-ws"]);
  });

  it("debug build saves stay in dev dir even when prod config was loaded", async () => {
    mockEnv({
      debug: true,
      configDir: DEV_CONFIG_DIR,
      files: {
        [`${PROD_CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
          theme: "prod-theme",
        }),
      },
    });
    await loadConfig();
    await saveConfig({ theme: "changed-in-dev" });

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain(`${DEV_CONFIG_DIR}/gnar-term.json`);
    expect(writes).not.toContain(`${PROD_CONFIG_DIR}/gnar-term.json`);
  });

  it("debug build prefers dev-dir gnar-term.json over prod when both exist", async () => {
    mockEnv({
      debug: true,
      configDir: DEV_CONFIG_DIR,
      files: {
        [`${DEV_CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
          theme: "dev-wins",
        }),
        [`${PROD_CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
          theme: "prod-loses",
        }),
      },
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("dev-wins");
  });

  it("release build does NOT fall back — prod path is already the canonical configDir", async () => {
    // In release builds configDir === PROD_CONFIG_DIR, so the prod entry is
    // already in the canonical candidate list. The fallback block must not
    // run (and must not duplicate-write to gnar-term.json on save).
    mockEnv({
      debug: false,
      configDir: PROD_CONFIG_DIR,
      files: {
        [`${PROD_CONFIG_DIR}/gnar-term.json`]: JSON.stringify({
          theme: "release",
        }),
      },
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("release");

    await saveConfig({ theme: "release2" });
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain(`${PROD_CONFIG_DIR}/gnar-term.json`);
  });
});

describe("loadState — debug builds fall back to prod state.json", () => {
  const HOME = "/home/test";
  const DEV_CONFIG_DIR = `${HOME}/.config/gnar-term-dev`;
  const PROD_CONFIG_DIR = `${HOME}/.config/gnar-term`;

  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    const { resetConfigDirForTests, resetIsDebugBuildForTests } =
      await import("../lib/services/service-helpers");
    resetConfigDirForTests();
    resetIsDebugBuildForTests();
    resetConfigStateForTests();
  });

  function mockEnv(opts: {
    debug: boolean;
    configDir: string;
    files: Record<string, string>;
  }) {
    vi.mocked(invoke).mockImplementation(
      async (cmd: string, args?: unknown) => {
        if (cmd === "get_home") return HOME;
        if (cmd === "get_global_config_dir") return opts.configDir;
        if (cmd === "is_debug_build") return opts.debug;
        if (cmd === "ensure_dir") return null;
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (opts.files[path] !== undefined) return opts.files[path];
          throw new Error(`ENOENT: ${path}`);
        }
        if (cmd === "write_file") return null;
        return null;
      },
    );
  }

  it("debug build with no dev state.json reads prod state.json", async () => {
    const { loadState } = await import("../lib/config");
    mockEnv({
      debug: true,
      configDir: DEV_CONFIG_DIR,
      files: {
        [`${PROD_CONFIG_DIR}/state.json`]: JSON.stringify({
          workspaces: [
            {
              name: "from-prod",
              layout: { pane: { surfaces: [{ type: "terminal" }] } },
            },
          ],
        }),
      },
    });
    const state = await loadState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces![0].name).toBe("from-prod");
  });

  it("debug build prefers dev state.json when both exist", async () => {
    const { loadState } = await import("../lib/config");
    mockEnv({
      debug: true,
      configDir: DEV_CONFIG_DIR,
      files: {
        [`${DEV_CONFIG_DIR}/state.json`]: JSON.stringify({
          workspaces: [
            { name: "from-dev", layout: { pane: { surfaces: [] } } },
          ],
        }),
        [`${PROD_CONFIG_DIR}/state.json`]: JSON.stringify({
          workspaces: [
            { name: "from-prod", layout: { pane: { surfaces: [] } } },
          ],
        }),
      },
    });
    const state = await loadState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces![0].name).toBe("from-dev");
  });

  it("release build does NOT fall back to a different path", async () => {
    const { loadState } = await import("../lib/config");
    mockEnv({
      debug: false,
      configDir: PROD_CONFIG_DIR,
      files: {
        [`${PROD_CONFIG_DIR}/state.json`]: JSON.stringify({
          workspaces: [{ name: "release", layout: { pane: { surfaces: [] } } }],
        }),
      },
    });
    const state = await loadState();
    expect(state.workspaces![0].name).toBe("release");

    // Only one read path attempted (no fallback dance).
    const reads = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "read_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(reads).toEqual([`${PROD_CONFIG_DIR}/state.json`]);
  });
});
