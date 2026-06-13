import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  extensionSidebarSections,
  upsertSection,
  removeSection,
  removeSectionsForWorkspace,
  extensionSections,
  _resetExtensionSidebarForTest,
} from "../lib/stores/extension-sidebar";
import {
  workspaces,
  activeWorkspaceIdx,
} from "../lib/stores/workspace";
import type { Workspace, Pane } from "../lib/types";

function setActiveWorkspace(id: string): void {
  const pane: Pane = { id: `${id}-pane`, surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id,
    name: id,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  workspaces.set([ws]);
  activeWorkspaceIdx.set(0);
}

describe("extension-sidebar store (per-workspace)", () => {
  beforeEach(() => {
    _resetExtensionSidebarForTest();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("starts empty", () => {
    setActiveWorkspace("ws-1");
    expect(get(extensionSidebarSections).size).toBe(0);
    expect(get(extensionSections)).toEqual([]);
  });

  it("upserts sections within a workspace", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      sectionId: "p1",
      title: "P1",
      items: [{ id: "a", label: "A" }],
      workspaceId: "ws-1",
    });
    upsertSection({
      sectionId: "s1",
      title: "S1",
      items: [{ id: "b", label: "B" }],
      workspaceId: "ws-1",
    });
    expect(get(extensionSections)).toHaveLength(2);
    expect(get(extensionSections).map((s) => s.title).sort()).toEqual([
      "P1",
      "S1",
    ]);
  });

  it("replaces an existing section with the same id within the same workspace", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      sectionId: "s1",
      title: "first",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      sectionId: "s1",
      title: "second",
      items: [{ id: "x", label: "X" }],
      workspaceId: "ws-1",
    });
    const sections = get(extensionSections);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("second");
    expect(sections[0].items).toEqual([{ id: "x", label: "X" }]);
  });

  it("removeSection is safe for non-existent IDs", () => {
    setActiveWorkspace("ws-1");
    removeSection("ws-1", "nope");
    expect(get(extensionSections)).toEqual([]);
  });

  it("removeSection removes the matching section", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      sectionId: "tools",
      title: "Tools",
      items: [],
      workspaceId: "ws-1",
    });
    expect(get(extensionSections)).toHaveLength(1);
    removeSection("ws-1", "tools");
    expect(get(extensionSections)).toHaveLength(0);
  });

  it("scopes sections per workspace: a section in W2 is invisible from W1", () => {
    // Two workspaces.
    const p1: Pane = { id: "p-1", surfaces: [], activeSurfaceId: null };
    const p2: Pane = { id: "p-2", surfaces: [], activeSurfaceId: null };
    const w1: Workspace = {
      id: "ws-1",
      name: "W1",
      splitRoot: { type: "pane", pane: p1 },
      activePaneId: p1.id,
    };
    const w2: Workspace = {
      id: "ws-2",
      name: "W2",
      splitRoot: { type: "pane", pane: p2 },
      activePaneId: p2.id,
    };
    workspaces.set([w1, w2]);
    activeWorkspaceIdx.set(0); // active = W1

    upsertSection({
      sectionId: "shared-id",
      title: "in W1",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      sectionId: "shared-id",
      title: "in W2",
      items: [],
      workspaceId: "ws-2",
    });

    // Looking at W1 — only the W1 section should be visible.
    expect(get(extensionSections)).toHaveLength(1);
    expect(get(extensionSections)[0].title).toBe("in W1");

    // Switch to W2 — only the W2 section should be visible.
    activeWorkspaceIdx.set(1);
    expect(get(extensionSections)).toHaveLength(1);
    expect(get(extensionSections)[0].title).toBe("in W2");
  });

  it("removeSectionsForWorkspace prunes everything tied to a destroyed workspace", () => {
    setActiveWorkspace("ws-doomed");
    upsertSection({
      sectionId: "a",
      title: "A",
      items: [],
      workspaceId: "ws-doomed",
    });
    upsertSection({
      sectionId: "b",
      title: "B",
      items: [],
      workspaceId: "ws-doomed",
    });
    upsertSection({
      sectionId: "c",
      title: "C",
      items: [],
      workspaceId: "ws-survivor",
    });
    expect(get(extensionSidebarSections).size).toBe(3);
    removeSectionsForWorkspace("ws-doomed");
    const remaining = Array.from(get(extensionSidebarSections).values());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe("ws-survivor");
  });
});
