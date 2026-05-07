/**
 * Tests for Svelte stores — workspace state management and derived stores
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../lib/stores/workspace";
import {
  sidebarVisible,
  commandPaletteOpen,
  findBarVisible,
  contextMenu,
} from "../lib/stores/ui";
import type { Workspace, Pane, TerminalSurface } from "../lib/types";

function makeSurface(id: string): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {} as unknown as TerminalSurface["terminal"],
    fitAddon: { fit: () => {} } as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
    ptyId: 1,
    title: `Shell ${id}`,
    hasUnread: false,
    opened: true,
  };
}

function makeChildWorkspace(id: string, name: string): Workspace {
  const s1 = makeSurface(`${id}-s1`);
  const pane: Pane = { id: `${id}-p1`, surfaces: [s1], activeSurfaceId: s1.id };
  return {
    id,
    name,
    paneLayout: { type: "pane", pane },
    activePaneId: pane.id,
  };
}

describe("Workspace stores", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("starts with empty workspaces", () => {
    expect(get(workspaces)).toEqual([]);
    expect(get(activeWorkspaceIdx)).toBe(-1);
    expect(get(activeWorkspace)).toBeNull();
  });

  it("derives activeWorkspace from idx", () => {
    const ws1 = makeChildWorkspace("ws1", "Workspace 1");
    const ws2 = makeChildWorkspace("ws2", "Workspace 2");
    workspaces.set([ws1, ws2]);
    activeWorkspaceIdx.set(0);

    expect(get(activeWorkspace)?.name).toBe("Workspace 1");

    activeWorkspaceIdx.set(1);
    expect(get(activeWorkspace)?.name).toBe("Workspace 2");
  });

  it("derives activePane from activeWorkspace", () => {
    const ws = makeChildWorkspace("ws1", "Test");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    const pane = get(activePane);
    expect(pane).not.toBeNull();
    expect(pane!.id).toBe("ws1-p1");
  });

  it("derives activeSurface from activePane", () => {
    const ws = makeChildWorkspace("ws1", "Test");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    const surface = get(activeSurface);
    expect(surface).not.toBeNull();
    expect(surface!.id).toBe("ws1-s1");
  });

  it("returns null for out-of-bounds idx", () => {
    workspaces.set([makeChildWorkspace("ws1", "Test")]);
    activeWorkspaceIdx.set(5);
    expect(get(activeWorkspace)).toBeNull();
  });

  it("handles workspace updates reactively", () => {
    const ws = makeChildWorkspace("ws1", "Test");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    expect(get(activeWorkspace)?.name).toBe("Test");

    workspaces.update((list) => {
      list[0].name = "Updated";
      return [...list];
    });

    expect(get(activeWorkspace)?.name).toBe("Updated");
  });

  it("handles multiple surfaces in a pane", () => {
    const s1 = makeSurface("s1");
    const s2 = makeSurface("s2");
    const pane: Pane = { id: "p1", surfaces: [s1, s2], activeSurfaceId: "s2" };
    const ws: Workspace = {
      id: "ws1",
      name: "Test",
      paneLayout: { type: "pane", pane },
      activePaneId: "p1",
    };

    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    const surface = get(activeSurface);
    expect(surface?.id).toBe("s2");
  });
});

describe("UI stores", () => {
  it("sidebarVisible defaults to true", () => {
    expect(get(sidebarVisible)).toBe(true);
  });

  it("commandPaletteOpen defaults to false", () => {
    expect(get(commandPaletteOpen)).toBe(false);
  });

  it("findBarVisible defaults to false", () => {
    expect(get(findBarVisible)).toBe(false);
  });

  it("contextMenu defaults to null", () => {
    expect(get(contextMenu)).toBeNull();
  });

  it("toggles sidebar visibility", () => {
    sidebarVisible.set(false);
    expect(get(sidebarVisible)).toBe(false);
    sidebarVisible.set(true);
    expect(get(sidebarVisible)).toBe(true);
  });

  it("sets context menu state", () => {
    contextMenu.set({
      x: 100,
      y: 200,
      items: [{ label: "Test", action: () => {} }],
    });
    const state = get(contextMenu);
    expect(state?.x).toBe(100);
    expect(state?.y).toBe(200);
    expect(state?.items).toHaveLength(1);
  });
});
