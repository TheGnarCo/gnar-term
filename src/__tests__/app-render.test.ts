/**
 * Behavioral checks for app-level pieces. (The original file leaned
 * heavily on source-scanning assertions — `readFileSync` against
 * `.svelte` / `.ts` then grepping for substrings — which verified file
 * text rather than behavior. Those have been removed; the genuine
 * behavioral and API-existence tests are kept here.)
 */
import { describe, it, expect, vi } from "vitest";
import type { TerminalSurface } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("svelte", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, tick: vi.fn().mockResolvedValue(undefined) };
});

describe("terminal-service exports", () => {
  it("openTerminalSurface was removed (sole owner is TerminalSurface.svelte)", async () => {
    const ts = await import("../lib/terminal-service");
    expect(
      (ts as Record<string, unknown>)["openTerminalSurface"],
    ).toBeUndefined();
  });

  it("exports createTerminalSurface, getActiveCwd, startCwdPolling", async () => {
    const ts = await import("../lib/terminal-service");
    const helpers = await import("../lib/services/service-helpers");
    expect(typeof ts.createTerminalSurface).toBe("function");
    expect(typeof helpers.getActiveCwd).toBe("function");
    expect(typeof ts.startCwdPolling).toBe("function");
  });
});

describe("Pane type has an element property", () => {
  it("constructed Pane accepts element field and getAllPanes traverses it", async () => {
    const types = await import("../lib/types");
    const pane: import("../lib/types").Pane = {
      id: "test",
      surfaces: [],
      activeSurfaceId: null,
      element: undefined,
    };
    expect("element" in pane).toBe(true);
    const node: import("../lib/types").SplitNode = { type: "pane", pane };
    expect(types.getAllPanes(node)).toHaveLength(1);
  });
});

describe("pane-service exports", () => {
  it("exports flashFocusedPane and reorderTab", async () => {
    const ps = await import("../lib/services/pane-service");
    expect(typeof ps.flashFocusedPane).toBe("function");
    expect(typeof ps.reorderTab).toBe("function");
  });
});

describe("preview-service exports", () => {
  it("exports refreshPreviewStyles", async () => {
    const preview = await import("../lib/services/preview-service");
    expect(typeof preview.refreshPreviewStyles).toBe("function");
  });
});

describe("workspace runtime service", () => {
  it("exports createWorkspaceFromDef and saveCurrentWorkspace", async () => {
    const ws = await import("../lib/services/workspace-runtime-service");
    expect(typeof ws.createWorkspaceFromDef).toBe("function");
    expect(typeof ws.saveCurrentWorkspace).toBe("function");
  });

  it("serializeLayout produces config-compatible output", async () => {
    const { serializeLayout } =
      await import("../lib/services/workspace-runtime-service");

    const paneNode: import("../lib/types").SplitNode = {
      type: "pane",
      pane: {
        id: "p1",
        surfaces: [
          {
            kind: "terminal",
            id: "s1",
            title: "zsh",
            cwd: "/home/user",
            hasUnread: false,
            opened: true,
            ptyId: 1,
            terminal: {} as unknown as TerminalSurface["terminal"],
            fitAddon: {} as unknown as TerminalSurface["fitAddon"],
            searchAddon: {} as unknown as TerminalSurface["searchAddon"],
            termElement: {} as unknown as TerminalSurface["termElement"],
          },
        ],
        activeSurfaceId: "s1",
      },
    };
    const result = serializeLayout(paneNode);
    expect(result).toHaveProperty("pane");
    const pane = (result as { pane: { surfaces: Record<string, unknown>[] } })
      .pane;
    expect(pane.surfaces).toHaveLength(1);
    expect(pane.surfaces[0].type).toBe("terminal");
    expect(pane.surfaces[0].name).toBeUndefined();
    expect(pane.surfaces[0].cwd).toBe("/home/user");
    expect(pane.surfaces[0].focus).toBe(true);

    const splitNode: import("../lib/types").SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      children: [paneNode, paneNode],
    };
    const splitResult = serializeLayout(splitNode);
    expect(splitResult).toHaveProperty("direction", "horizontal");
    expect(splitResult).toHaveProperty("split", 0.6);
    expect(splitResult).toHaveProperty("children");
  });
});
