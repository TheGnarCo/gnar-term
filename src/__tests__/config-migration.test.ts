/**
 * Schema migration for configs written by older (origin/main-era) gnar-term
 * builds. Both the main and dev release builds read `~/.config/gnar-term/`,
 * so dev must accept main's on-disk shape without losing or silently
 * misinterpreting fields.
 *
 * Covered today:
 *   - SurfaceDef.type "markdown" (main) → "preview" (dev). Same `path`
 *     field, so the rest of the def survives.
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
  type GnarTermConfig,
  type LayoutNode,
} from "../lib/config";

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

describe("loadConfig — gnar-term.json one-shot migration", () => {
  const HOME = "/home/test";
  const CONFIG_DIR = `${HOME}/.config/gnar-term`;

  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    const { resetConfigDirForTests } =
      await import("../lib/services/service-helpers");
    resetConfigDirForTests();
  });

  function mockFileSystem(files: Record<string, string>) {
    vi.mocked(invoke).mockImplementation(
      // @ts-expect-error — vitest mock signature is permissive
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

  it("reads from global gnar-term.json when settings.json is absent", async () => {
    mockFileSystem({
      [`${CONFIG_DIR}/gnar-term.json`]: JSON.stringify({ theme: "old-theme" }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("old-theme");
  });

  it("redirects next save to settings.json after loading from gnar-term.json", async () => {
    mockFileSystem({
      [`${CONFIG_DIR}/gnar-term.json`]: JSON.stringify({ theme: "old-theme" }),
    });
    await loadConfig();
    await saveConfig({ theme: "old-theme" });

    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);

    expect(writes).toContain(`${CONFIG_DIR}/settings.json`);
    expect(writes).not.toContain(`${CONFIG_DIR}/gnar-term.json`);
  });

  it("prefers settings.json over gnar-term.json when both exist", async () => {
    mockFileSystem({
      [`${CONFIG_DIR}/settings.json`]: JSON.stringify({ theme: "new-theme" }),
      [`${CONFIG_DIR}/gnar-term.json`]: JSON.stringify({ theme: "old-theme" }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("new-theme");
  });

  it("reads from per-project gnar-term.json and forwards to per-project settings.json", async () => {
    mockFileSystem({
      "gnar-term.json": JSON.stringify({ theme: "project-old" }),
    });
    const cfg = await loadConfig();
    expect(cfg.theme).toBe("project-old");

    await saveConfig({ theme: "project-old" });
    const writes = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "write_file")
      .map(([, args]) => (args as { path: string }).path);
    expect(writes).toContain("settings.json");
    expect(writes).not.toContain("gnar-term.json");
  });
});
