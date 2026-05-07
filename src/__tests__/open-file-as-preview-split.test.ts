/**
 * openFileAsPreviewSplit — opens a markdown file as a side-by-side preview.
 *
 * Verifies: horizontal split creation, preview surface placement,
 * deduplication (focus existing instead of opening a second copy), and
 * the canPreview-based fallback to `open_with_default_app` for files
 * without a registered previewer (B10/D3 wiring).
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
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

import { invoke } from "@tauri-apps/api/core";
import { openFileAsPreviewSplit } from "../lib/services/surface-service";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { isPreviewSurface, getAllSurfaces, getAllPanes } from "../lib/types";
import type { Workspace, Pane } from "../lib/types";
import {
  registerPreviewSurface,
  resetPreviewSurfaceRegistry,
} from "../lib/services/preview-surface-registry";
import { clearPreviewers } from "../lib/services/preview-registry";

const mockInvoke = vi.mocked(invoke);

// Register at least the markdown previewer so canPreview("/docs/README.md")
// returns true. Without this the new canPreview gate in
// openFileAsPreviewSplit would short-circuit every test.
beforeAll(async () => {
  clearPreviewers();
  await import("../lib/preview/previewers/markdown");
});

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
    mockInvoke.mockClear();
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

  it("falls back to open_with_default_app for files without a registered previewer", () => {
    const { ws, pane } = makeChildWorkspace("ws-1");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    openFileAsPreviewSplit("/tmp/installer.exe");

    // No split, no preview surface — the file was handed off to the OS.
    const allPanes = getAllPanes(get(workspaces)[0]!.paneLayout);
    expect(allPanes).toHaveLength(1);
    expect(allPanes[0]!.id).toBe(pane.id);
    expect(getAllSurfaces(get(workspaces)[0]!)).toHaveLength(0);

    expect(mockInvoke).toHaveBeenCalledWith("open_with_default_app", {
      path: "/tmp/installer.exe",
    });
  });

  it("does not fall back when the extension has a registered previewer", () => {
    const { ws } = makeChildWorkspace("ws-1");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    openFileAsPreviewSplit("/docs/README.md");

    // The markdown previewer is registered, so the gate must let this through
    // and we should NOT have invoked the OS handoff.
    const openCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "open_with_default_app",
    );
    expect(openCalls).toHaveLength(0);
  });
});
