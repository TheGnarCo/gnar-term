/**
 * Tests for the maximize-one-pane (zoom) feature and persisted terminal
 * font-size zoom.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

// Mock the config module so font-size persistence is observable without
// hitting the Tauri filesystem commands.
const h = vi.hoisted(() => {
  const state = { config: { fontSize: 14 } as { fontSize?: number } };
  const saveConfig = vi.fn(async (u: { fontSize?: number }) => {
    state.config = { ...state.config, ...u };
  });
  return { state, saveConfig };
});
vi.mock("../lib/config", () => ({
  getConfig: () => h.state.config,
  saveConfig: h.saveConfig,
}));

import { workspaces, zoomedSurfaceId } from "../lib/stores/workspace";
import { nodeContainsSurface } from "../lib/types";
import type { Workspace, Pane, Surface, SplitNode, TerminalSurface } from "../lib/types";
import { togglePaneZoom } from "../lib/services/pane-service";
import {
  adjustFontSize,
  resetFontSize,
  getFontSize,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  FONT_SIZE_DEFAULT,
} from "../lib/terminal-service";

function makeTerminal(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: { options: {} } as any,
    fitAddon: { fit: vi.fn() } as any,
    searchAddon: {} as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: id,
    hasUnread: false,
    opened: true,
  };
}

function paneNode(surfaces: Surface[], paneId: string): SplitNode {
  const pane: Pane = { id: paneId, surfaces, activeSurfaceId: surfaces[0]?.id ?? null };
  return { type: "pane", pane };
}

describe("nodeContainsSurface", () => {
  it("finds a surface nested inside a split tree", () => {
    const a = makeTerminal("a");
    const b = makeTerminal("b");
    const tree: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [paneNode([a], "p1"), paneNode([b], "p2")],
    };
    expect(nodeContainsSurface(tree, "a")).toBe(true);
    expect(nodeContainsSurface(tree, "b")).toBe(true);
    expect(nodeContainsSurface(tree, "missing")).toBe(false);
  });
});

describe("togglePaneZoom", () => {
  beforeEach(() => zoomedSurfaceId.set(null));

  it("zooms, then un-zooms the same surface", () => {
    togglePaneZoom("s1");
    expect(get(zoomedSurfaceId)).toBe("s1");
    togglePaneZoom("s1");
    expect(get(zoomedSurfaceId)).toBeNull();
  });

  it("switches zoom directly to a different surface", () => {
    togglePaneZoom("s1");
    togglePaneZoom("s2");
    expect(get(zoomedSurfaceId)).toBe("s2");
  });
});

describe("terminal font size", () => {
  beforeEach(() => {
    h.state.config = { fontSize: FONT_SIZE_DEFAULT };
    h.saveConfig.mockClear();
    workspaces.set([]);
  });

  it("adjustFontSize persists and applies to every open terminal", () => {
    const t = makeTerminal("a");
    const ws: Workspace = {
      id: "w",
      name: "w",
      splitRoot: paneNode([t], "p"),
      activePaneId: "p",
    };
    workspaces.set([ws]);

    adjustFontSize(2);

    expect(h.saveConfig).toHaveBeenCalledWith({ fontSize: 16 });
    expect((t.terminal.options as any).fontSize).toBe(16);
    expect(t.fitAddon.fit).toHaveBeenCalled();
  });

  it("clamps to the supported range", () => {
    h.state.config = { fontSize: FONT_SIZE_MAX - 1 };
    adjustFontSize(10);
    expect(getFontSize()).toBe(FONT_SIZE_MAX);

    h.state.config = { fontSize: FONT_SIZE_MIN + 1 };
    adjustFontSize(-10);
    expect(getFontSize()).toBe(FONT_SIZE_MIN);
  });

  it("does not persist when already at the clamp boundary", () => {
    h.state.config = { fontSize: FONT_SIZE_MAX };
    adjustFontSize(1);
    expect(h.saveConfig).not.toHaveBeenCalled();
  });

  it("resetFontSize returns to the default", () => {
    h.state.config = { fontSize: 22 };
    resetFontSize();
    expect(h.saveConfig).toHaveBeenCalledWith({ fontSize: FONT_SIZE_DEFAULT });
  });
});
