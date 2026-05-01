/**
 * Tests for Svelte stores — workspace state management and derived stores
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
  activeWorkspace,
  activePane,
  activeSurface,
} from "../lib/stores/nested-workspace";
import {
  primarySidebarVisible,
  secondarySidebarVisible,
  commandPaletteOpen,
  findBarVisible,
  contextMenu,
} from "../lib/stores/ui";
import type { NestedWorkspace, Pane, TerminalSurface } from "../lib/types";

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

function makeNestedWorkspace(id: string, name: string): NestedWorkspace {
  const s1 = makeSurface(`${id}-s1`);
  const pane: Pane = { id: `${id}-p1`, surfaces: [s1], activeSurfaceId: s1.id };
  return {
    id,
    name,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
}

describe("NestedWorkspace stores", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("starts with empty nestedWorkspaces", () => {
    expect(get(nestedWorkspaces)).toEqual([]);
    expect(get(activeNestedWorkspaceIdx)).toBe(-1);
    expect(get(activeWorkspace)).toBeNull();
  });

  it("derives activeWorkspace from idx", () => {
    const ws1 = makeNestedWorkspace("ws1", "Workspace 1");
    const ws2 = makeNestedWorkspace("ws2", "Workspace 2");
    nestedWorkspaces.set([ws1, ws2]);
    activeNestedWorkspaceIdx.set(0);

    expect(get(activeWorkspace)?.name).toBe("Workspace 1");

    activeNestedWorkspaceIdx.set(1);
    expect(get(activeWorkspace)?.name).toBe("Workspace 2");
  });

  it("derives activePane from activeWorkspace", () => {
    const ws = makeNestedWorkspace("ws1", "Test");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const pane = get(activePane);
    expect(pane).not.toBeNull();
    expect(pane!.id).toBe("ws1-p1");
  });

  it("derives activeSurface from activePane", () => {
    const ws = makeNestedWorkspace("ws1", "Test");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const surface = get(activeSurface);
    expect(surface).not.toBeNull();
    expect(surface!.id).toBe("ws1-s1");
  });

  it("returns null for out-of-bounds idx", () => {
    nestedWorkspaces.set([makeNestedWorkspace("ws1", "Test")]);
    activeNestedWorkspaceIdx.set(5);
    expect(get(activeWorkspace)).toBeNull();
  });

  it("handles workspace updates reactively", () => {
    const ws = makeNestedWorkspace("ws1", "Test");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    expect(get(activeWorkspace)?.name).toBe("Test");

    nestedWorkspaces.update((list) => {
      list[0].name = "Updated";
      return [...list];
    });

    expect(get(activeWorkspace)?.name).toBe("Updated");
  });

  it("handles multiple surfaces in a pane", () => {
    const s1 = makeSurface("s1");
    const s2 = makeSurface("s2");
    const pane: Pane = { id: "p1", surfaces: [s1, s2], activeSurfaceId: "s2" };
    const ws: NestedWorkspace = {
      id: "ws1",
      name: "Test",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };

    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    const surface = get(activeSurface);
    expect(surface?.id).toBe("s2");
  });
});

describe("UI stores", () => {
  it("primarySidebarVisible defaults to true", () => {
    expect(get(primarySidebarVisible)).toBe(true);
  });

  it("secondarySidebarVisible defaults to false", () => {
    expect(get(secondarySidebarVisible)).toBe(false);
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

  it("toggles primary sidebar visibility", () => {
    primarySidebarVisible.set(false);
    expect(get(primarySidebarVisible)).toBe(false);
    primarySidebarVisible.set(true);
    expect(get(primarySidebarVisible)).toBe(true);
  });

  it("toggles secondary sidebar visibility", () => {
    secondarySidebarVisible.set(true);
    expect(get(secondarySidebarVisible)).toBe(true);
    secondarySidebarVisible.set(false);
    expect(get(secondarySidebarVisible)).toBe(false);
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
