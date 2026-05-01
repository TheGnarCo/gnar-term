/**
 * openFileAsPreviewSplit — opens a markdown file as a side-by-side preview.
 *
 * Verifies: horizontal split creation, preview surface placement,
 * deduplication (focus existing instead of opening a second copy),
 * and that md/markdown/mdx are exposed as registered file extensions
 * once the file-browser extension registers its context menu item.
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
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import { isPreviewSurface, getAllSurfaces, getAllPanes } from "../lib/types";
import type { NestedWorkspace, Pane } from "../lib/types";
import {
  registerPreviewSurface,
  resetPreviewSurfaceRegistry,
} from "../lib/services/preview-surface-registry";
import {
  resetContextMenuItems,
  registerContextMenuItem,
  getRegisteredFileExtensions,
  getContextMenuItemsForFile,
} from "../lib/services/context-menu-item-registry";

function makeNestedWorkspace(id: string): { ws: NestedWorkspace; pane: Pane } {
  const pane: Pane = { id: `${id}-pane`, surfaces: [], activeSurfaceId: null };
  const ws: NestedWorkspace = {
    id,
    name: id,
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  return { ws, pane };
}

describe("openFileAsPreviewSplit", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    resetPreviewSurfaceRegistry();
  });

  it("splits horizontally and places a preview surface in the new pane", () => {
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    openFileAsPreviewSplit("/docs/README.md");

    const allPanes = getAllPanes(get(nestedWorkspaces)[0]!.splitRoot);
    expect(allPanes).toHaveLength(2);

    const newPane = allPanes.find((p) => p.id !== pane.id)!;
    expect(newPane).toBeTruthy();

    const surfaces = getAllSurfaces(get(nestedWorkspaces)[0]!);
    expect(surfaces).toHaveLength(1);
    const surface = surfaces[0]!;
    expect(isPreviewSurface(surface)).toBe(true);
    if (isPreviewSurface(surface)) {
      expect(surface.path).toBe("/docs/README.md");
    }
  });

  it("uses a horizontal split so the preview appears side-by-side", () => {
    const { ws } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    openFileAsPreviewSplit("/docs/README.md");

    const splitRoot = get(nestedWorkspaces)[0]!.splitRoot;
    expect(splitRoot.type).toBe("split");
    if (splitRoot.type === "split") {
      expect(splitRoot.direction).toBe("horizontal");
    }
  });

  it("focuses an existing preview instead of opening a duplicate", () => {
    const { ws, pane } = makeNestedWorkspace("ws-1");
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    registerPreviewSurface({
      surfaceId: "existing-surface",
      path: "/docs/README.md",
      paneId: pane.id,
      workspaceId: "ws-1",
    });

    openFileAsPreviewSplit("/docs/README.md");

    // No split should have occurred — still only one pane.
    const allPanes = getAllPanes(get(nestedWorkspaces)[0]!.splitRoot);
    expect(allPanes).toHaveLength(1);

    // No new surface placed.
    expect(getAllSurfaces(get(nestedWorkspaces)[0]!)).toHaveLength(0);
  });

  it("does nothing when there is no active workspace", () => {
    openFileAsPreviewSplit("/docs/README.md");
    // No crash, no state change.
    expect(get(nestedWorkspaces)).toHaveLength(0);
  });
});

describe("file-browser markdown context menu item", () => {
  beforeEach(() => {
    resetContextMenuItems();
  });

  it("md, markdown, and mdx appear in registered extensions after the item is registered", () => {
    registerContextMenuItem({
      id: "open-as-preview",
      source: "file-browser",
      label: "Open as Preview",
      when: "*.{md,markdown,mdx}",
      handler: () => {},
    });

    const exts = getRegisteredFileExtensions();
    expect(exts).toContain("md");
    expect(exts).toContain("markdown");
    expect(exts).toContain("mdx");
  });

  it("open-as-preview is items[0] for .md files when registered before generic items", () => {
    // Simulate file-browser registration order: specific item first
    registerContextMenuItem({
      id: "file-browser:open-as-preview",
      source: "file-browser",
      label: "Open as Preview",
      when: "*.{md,markdown,mdx}",
      handler: () => {},
    });
    registerContextMenuItem({
      id: "file-browser:edit",
      source: "file-browser",
      label: "Edit",
      when: "*",
      handler: () => {},
    });

    const items = getContextMenuItemsForFile("/path/to/notes.md");
    expect(items[0]?.id).toBe("file-browser:open-as-preview");
  });
});
