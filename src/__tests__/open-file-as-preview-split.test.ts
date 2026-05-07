/**
 * openFileAsPreviewSplit — opens a markdown file as a side-by-side preview.
 *
 * Verifies: horizontal split creation, preview surface placement, and
 * deduplication (focus existing instead of opening a second copy).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(),
}));

import { openFileAsPreviewSplit } from "../lib/services/surface-service";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { isPreviewSurface, getAllSurfaces, getAllPanes } from "../lib/types";
import type { Workspace, Pane } from "../lib/types";
import {
  registerPreviewSurface,
  resetPreviewSurfaceRegistry,
} from "../lib/services/preview-surface-registry";

function makeChildWorkspace(id: string): { ws: Workspace; pane: Pane } {
  const pane: Pane = { id: `${id}-pane`, surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id,
    name: id,
    paneLayout: { type: "pane", pane },
    activePaneId: pane.id,
  };
  return { ws, pane };
}

describe("openFileAsPreviewSplit", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetPreviewSurfaceRegistry();
  });

  it("splits horizontally and places a preview surface in the new pane", () => {
    const { ws, pane } = makeChildWorkspace("ws-1");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    openFileAsPreviewSplit("/docs/README.md");

    const allPanes = getAllPanes(get(workspaces)[0]!.paneLayout);
    expect(allPanes).toHaveLength(2);

    const newPane = allPanes.find((p) => p.id !== pane.id)!;
    expect(newPane).toBeTruthy();

    const surfaces = getAllSurfaces(get(workspaces)[0]!);
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0]!;
    expect(isPreviewSurface(surface)).toBe(true);
    if (isPreviewSurface(surface)) {
      expect(surface.path).toBe("/docs/README.md");
    }
  });

  it("uses a horizontal split so the preview appears side-by-side", () => {
    const { ws } = makeChildWorkspace("ws-1");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    openFileAsPreviewSplit("/docs/README.md");

    const paneLayout = get(workspaces)[0]!.paneLayout;
    expect(paneLayout.type).toBe("split");
    if (paneLayout.type === "split") {
      expect(paneLayout.direction).toBe("horizontal");
    }
  });

  it("focuses an existing preview instead of opening a duplicate", () => {
    const { ws, pane } = makeChildWorkspace("ws-1");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    registerPreviewSurface({
      surfaceId: "existing-surface",
      path: "/docs/README.md",
      paneId: pane.id,
      workspaceId: "ws-1",
    });

    openFileAsPreviewSplit("/docs/README.md");

    // No split should have occurred — still only one pane.
    const allPanes = getAllPanes(get(workspaces)[0]!.paneLayout);
    expect(allPanes).toHaveLength(1);

    // No new surface placed.
    expect(getAllSurfaces(get(workspaces)[0]!)).toHaveLength(0);
  });

  it("does nothing when there is no active workspace", () => {
    openFileAsPreviewSplit("/docs/README.md");
    // No crash, no state change.
    expect(get(workspaces)).toHaveLength(0);
  });
});
