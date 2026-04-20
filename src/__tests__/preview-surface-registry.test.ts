/**
 * preview-surface-registry: register / unregister / list / find-by-path.
 *
 * Mirrors the dropped meta-surface-registry tests one-to-one — the
 * registry is the same shape under a new name.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerPreviewSurface,
  unregisterPreviewSurface,
  listPreviewSurfaces,
  findPreviewSurfaceByPath,
  resetPreviewSurfaceRegistry,
  previewSurfaceStore,
} from "../lib/services/preview-surface-registry";

describe("preview-surface-registry", () => {
  beforeEach(() => {
    resetPreviewSurfaceRegistry();
  });

  it("registering a preview surface adds it to the registry", () => {
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/abs/design.md",
      paneId: "p1",
      workspaceId: "ws1",
    });

    const entries = listPreviewSurfaces();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      surfaceId: "s1",
      path: "/abs/design.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
  });

  it("unregistering removes the entry", () => {
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/abs/design.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
    registerPreviewSurface({
      surfaceId: "s2",
      path: "/abs/notes.md",
      paneId: "p1",
      workspaceId: "ws1",
    });

    unregisterPreviewSurface("s1");
    const entries = listPreviewSurfaces();
    expect(entries).toHaveLength(1);
    expect(entries[0].surfaceId).toBe("s2");
  });

  it("listPreviewSurfaces returns the active set", () => {
    expect(listPreviewSurfaces()).toEqual([]);
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/a.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
    registerPreviewSurface({
      surfaceId: "s2",
      path: "/b.md",
      paneId: "p2",
      workspaceId: "ws1",
    });
    expect(
      listPreviewSurfaces()
        .map((e) => e.surfaceId)
        .sort(),
    ).toEqual(["s1", "s2"]);
  });

  it("re-registering the same surfaceId updates instead of duplicating", () => {
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/old.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/new.md",
      paneId: "p2",
      workspaceId: "ws2",
    });
    const entries = listPreviewSurfaces();
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("/new.md");
    expect(entries[0].paneId).toBe("p2");
    expect(entries[0].workspaceId).toBe("ws2");
  });

  it("findPreviewSurfaceByPath returns the matching entry or undefined", () => {
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/abs/design.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
    expect(findPreviewSurfaceByPath("/abs/design.md")?.surfaceId).toBe("s1");
    expect(findPreviewSurfaceByPath("/missing.md")).toBeUndefined();
  });

  it("previewSurfaceStore exposes the entry list reactively", () => {
    expect(get(previewSurfaceStore)).toEqual([]);
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/x.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
    expect(get(previewSurfaceStore)).toHaveLength(1);
  });

  it("resetPreviewSurfaceRegistry clears all entries", () => {
    registerPreviewSurface({
      surfaceId: "s1",
      path: "/x.md",
      paneId: "p1",
      workspaceId: "ws1",
    });
    resetPreviewSurfaceRegistry();
    expect(listPreviewSurfaces()).toEqual([]);
  });
});
