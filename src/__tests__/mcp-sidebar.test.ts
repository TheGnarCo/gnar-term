import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  mcpSidebarSections,
  upsertSection,
  removeSection,
  removeSectionsForWorkspace,
  primarySections,
  secondarySections,
  _resetMcpSidebarForTest,
} from "../lib/stores/mcp-sidebar";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
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

describe("mcp-sidebar store (per-workspace)", () => {
  beforeEach(() => {
    _resetMcpSidebarForTest();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("starts empty", () => {
    setActiveWorkspace("ws-1");
    expect(get(mcpSidebarSections).size).toBe(0);
    expect(get(primarySections)).toEqual([]);
    expect(get(secondarySections)).toEqual([]);
  });

  it("upserts primary and secondary sections separately within a workspace", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      side: "primary",
      sectionId: "p1",
      title: "P1",
      items: [{ id: "a", label: "A" }],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "secondary",
      sectionId: "s1",
      title: "S1",
      items: [{ id: "b", label: "B" }],
      workspaceId: "ws-1",
    });
    expect(get(primarySections)).toHaveLength(1);
    expect(get(secondarySections)).toHaveLength(1);
    expect(get(primarySections)[0].title).toBe("P1");
    expect(get(secondarySections)[0].title).toBe("S1");
  });

  it("replaces an existing section with the same id within the same workspace", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      side: "secondary",
      sectionId: "s1",
      title: "first",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "secondary",
      sectionId: "s1",
      title: "second",
      items: [{ id: "x", label: "X" }],
      workspaceId: "ws-1",
    });
    const sections = get(secondarySections);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("second");
    expect(sections[0].items).toEqual([{ id: "x", label: "X" }]);
  });

  it("removeSection is safe for non-existent IDs", () => {
    setActiveWorkspace("ws-1");
    removeSection("ws-1", "primary", "nope");
    expect(get(primarySections)).toEqual([]);
  });

  it("allows the same section_id on different sides", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      side: "primary",
      sectionId: "tools",
      title: "P",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "secondary",
      sectionId: "tools",
      title: "S",
      items: [],
      workspaceId: "ws-1",
    });
    expect(get(primarySections)).toHaveLength(1);
    expect(get(secondarySections)).toHaveLength(1);
    removeSection("ws-1", "primary", "tools");
    expect(get(primarySections)).toHaveLength(0);
    expect(get(secondarySections)).toHaveLength(1);
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
      side: "secondary",
      sectionId: "shared-id",
      title: "in W1",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "secondary",
      sectionId: "shared-id",
      title: "in W2",
      items: [],
      workspaceId: "ws-2",
    });

    // Looking at W1 — only the W1 section should be visible.
    expect(get(secondarySections)).toHaveLength(1);
    expect(get(secondarySections)[0].title).toBe("in W1");

    // Switch to W2 — only the W2 section should be visible.
    activeWorkspaceIdx.set(1);
    expect(get(secondarySections)).toHaveLength(1);
    expect(get(secondarySections)[0].title).toBe("in W2");
  });

  it("removeSectionsForWorkspace prunes everything tied to a destroyed workspace", () => {
    setActiveWorkspace("ws-doomed");
    upsertSection({
      side: "primary",
      sectionId: "a",
      title: "A",
      items: [],
      workspaceId: "ws-doomed",
    });
    upsertSection({
      side: "secondary",
      sectionId: "b",
      title: "B",
      items: [],
      workspaceId: "ws-doomed",
    });
    upsertSection({
      side: "primary",
      sectionId: "c",
      title: "C",
      items: [],
      workspaceId: "ws-survivor",
    });
    expect(get(mcpSidebarSections).size).toBe(3);
    removeSectionsForWorkspace("ws-doomed");
    const remaining = Array.from(get(mcpSidebarSections).values());
    expect(remaining).toHaveLength(1);
    expect(remaining[0].workspaceId).toBe("ws-survivor");
  });
});
