/**
 * Persistence round-trip for PreviewSurface:
 *  - serializeLayout emits {type: "preview", path, name?} for a pane
 *    containing a PreviewSurface
 *  - createWorkspaceFromDef rehydrates a {type: "preview", path} surface
 *    def into a real PreviewSurface in the active workspace
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
  createTerminalSurface: vi.fn(async (pane: { surfaces: unknown[] }) => {
    const stub = {
      kind: "terminal" as const,
      id: `t-${Math.random().toString(36).slice(2)}`,
      title: "stub",
      ptyId: -1,
      hasUnread: false,
      opened: false,
    };
    pane.surfaces.push(stub);
    return stub;
  }),
}));

import {
  serializeLayout,
  createWorkspaceFromDef,
} from "../lib/services/workspace-service";
import { workspaces } from "../lib/stores/workspace";
import {
  isPreviewSurface,
  type NestedWorkspace,
  type PreviewSurface,
  type Pane,
} from "../lib/types";

describe("serializeLayout — preview surfaces", () => {
  it("emits {type: 'preview', path, name?} for a pane containing a PreviewSurface", () => {
    const surface: PreviewSurface = {
      kind: "preview",
      id: "m1",
      title: "design",
      path: "/abs/design.md",
      hasUnread: false,
    };
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: "m1",
    };
    const layout = serializeLayout({ type: "pane", pane });
    expect("pane" in layout).toBe(true);
    if (!("pane" in layout)) return;
    expect(layout.pane.surfaces).toEqual([
      { type: "preview", path: "/abs/design.md", name: "design", focus: true },
    ]);
  });

  it("omits the name field when the surface has an empty title", () => {
    const surface: PreviewSurface = {
      kind: "preview",
      id: "m2",
      title: "",
      path: "/abs/notes.md",
      hasUnread: false,
    };
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: "m2",
    };
    const layout = serializeLayout({ type: "pane", pane });
    if (!("pane" in layout)) throw new Error("expected pane node");
    expect(layout.pane.surfaces[0]).toEqual({
      type: "preview",
      path: "/abs/notes.md",
      focus: true,
    });
  });
});

describe("createWorkspaceFromDef — preview surfaces", () => {
  beforeEach(() => {
    workspaces.set([]);
  });

  it("rehydrates a {type: 'preview', path} surface def into a real PreviewSurface", async () => {
    await createWorkspaceFromDef({
      name: "Preview WS",
      layout: {
        pane: {
          surfaces: [{ type: "preview", path: "/abs/plan.md", focus: true }],
        },
      },
    });

    const list = get(workspaces);
    expect(list).toHaveLength(1);
    const ws = list[0] as NestedWorkspace;
    expect(ws.splitRoot.type).toBe("pane");
    if (ws.splitRoot.type !== "pane") return;
    const surfaces = ws.splitRoot.pane.surfaces;
    expect(surfaces).toHaveLength(1);
    const preview = surfaces[0];
    expect(isPreviewSurface(preview)).toBe(true);
    if (!isPreviewSurface(preview)) return;
    expect(preview.path).toBe("/abs/plan.md");
    expect(preview.title).toBe("plan");
    expect(preview.hasUnread).toBe(false);
    expect(ws.splitRoot.pane.activeSurfaceId).toBe(preview.id);
  });

  it("respects the name field from the surface def", async () => {
    await createWorkspaceFromDef({
      name: "Preview WS",
      layout: {
        pane: {
          surfaces: [
            {
              type: "preview",
              path: "/abs/sprint.md",
              name: "Current Sprint",
              focus: true,
            },
          ],
        },
      },
    });

    const ws = get(workspaces)[0]!;
    if (ws.splitRoot.type !== "pane") throw new Error("expected pane root");
    const preview = ws.splitRoot.pane.surfaces[0];
    if (!isPreviewSurface(preview)) throw new Error("expected preview surface");
    expect(preview.title).toBe("Current Sprint");
  });

  it("round-trips: serialize -> rehydrate produces the same surface def shape", async () => {
    const surface: PreviewSurface = {
      kind: "preview",
      id: "m1",
      title: "design",
      path: "/abs/design.md",
      hasUnread: false,
    };
    const pane: Pane = {
      id: "p1",
      surfaces: [surface],
      activeSurfaceId: "m1",
    };
    const layout = serializeLayout({ type: "pane", pane });

    await createWorkspaceFromDef({ name: "Round-trip WS", layout });

    const ws = get(workspaces)[0]!;
    if (ws.splitRoot.type !== "pane") throw new Error("expected pane root");
    const restored = ws.splitRoot.pane.surfaces[0];
    if (!isPreviewSurface(restored)) {
      throw new Error("expected preview surface");
    }
    expect(restored.path).toBe(surface.path);
    expect(restored.title).toBe(surface.title);
  });
});
