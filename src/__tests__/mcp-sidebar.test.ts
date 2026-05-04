import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  mcpSidebarSections,
  upsertSection,
  removeSection,
  removeSectionsForWorkspace,
  primarySections,
  _resetMcpSidebarForTest,
} from "../lib/stores/mcp-sidebar";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/nested-workspace";
import type { NestedWorkspace, Pane } from "../lib/types";

function setActiveWorkspace(id: string): void {
  const pane: Pane = { id: `${id}-pane`, surfaces: [], activeSurfaceId: null };
  const ws: NestedWorkspace = {
    id,
    name: id,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  nestedWorkspaces.set([ws]);
  activeNestedWorkspaceIdx.set(0);
}

describe("mcp-sidebar store (per-workspace)", () => {
  beforeEach(() => {
    _resetMcpSidebarForTest();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("starts empty", () => {
    setActiveWorkspace("ws-1");
    expect(get(mcpSidebarSections).size).toBe(0);
    expect(get(primarySections)).toEqual([]);
  });

  it("upserts multiple primary sections within a workspace", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      side: "primary",
      sectionId: "p1",
      title: "P1",
      items: [{ id: "a", label: "A" }],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "primary",
      sectionId: "p2",
      title: "P2",
      items: [{ id: "b", label: "B" }],
      workspaceId: "ws-1",
    });
    expect(get(primarySections)).toHaveLength(2);
    expect(get(primarySections)[0].title).toBe("P1");
    expect(get(primarySections)[1].title).toBe("P2");
  });

  it("replaces an existing section with the same id within the same workspace", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      side: "primary",
      sectionId: "p1",
      title: "first",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "primary",
      sectionId: "p1",
      title: "second",
      items: [{ id: "x", label: "X" }],
      workspaceId: "ws-1",
    });
    const sections = get(primarySections);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("second");
    expect(sections[0].items).toEqual([{ id: "x", label: "X" }]);
  });

  it("removeSection is safe for non-existent IDs", () => {
    setActiveWorkspace("ws-1");
    removeSection("ws-1", "primary", "nope");
    expect(get(primarySections)).toEqual([]);
  });

  it("allows multiple primary sections with different ids", () => {
    setActiveWorkspace("ws-1");
    upsertSection({
      side: "primary",
      sectionId: "tools-a",
      title: "A",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "primary",
      sectionId: "tools-b",
      title: "B",
      items: [],
      workspaceId: "ws-1",
    });
    expect(get(primarySections)).toHaveLength(2);
    removeSection("ws-1", "primary", "tools-a");
    expect(get(primarySections)).toHaveLength(1);
    expect(get(primarySections)[0].sectionId).toBe("tools-b");
  });

  it("scopes sections per workspace: a section in W2 is invisible from W1", () => {
    // Two nestedWorkspaces.
    const p1: Pane = { id: "p-1", surfaces: [], activeSurfaceId: null };
    const p2: Pane = { id: "p-2", surfaces: [], activeSurfaceId: null };
    const w1: NestedWorkspace = {
      id: "ws-1",
      name: "W1",
      splitRoot: { type: "pane", pane: p1 },
      activePaneId: p1.id,
    };
    const w2: NestedWorkspace = {
      id: "ws-2",
      name: "W2",
      splitRoot: { type: "pane", pane: p2 },
      activePaneId: p2.id,
    };
    nestedWorkspaces.set([w1, w2]);
    activeNestedWorkspaceIdx.set(0); // active = W1

    upsertSection({
      side: "primary",
      sectionId: "shared-id",
      title: "in W1",
      items: [],
      workspaceId: "ws-1",
    });
    upsertSection({
      side: "primary",
      sectionId: "shared-id",
      title: "in W2",
      items: [],
      workspaceId: "ws-2",
    });

    // Looking at W1 — only the W1 section should be visible.
    expect(get(primarySections)).toHaveLength(1);
    expect(get(primarySections)[0].title).toBe("in W1");

    // Switch to W2 — only the W2 section should be visible.
    activeNestedWorkspaceIdx.set(1);
    expect(get(primarySections)).toHaveLength(1);
    expect(get(primarySections)[0].title).toBe("in W2");
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
      side: "primary",
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
