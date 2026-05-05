/**
 * Tests for claimed-workspace-registry — Stage 10:
 * `claimedWorkspaceIds` is derived from `workspaces` filtered by
 * `parentWorkspaceId`. The legacy registry that tracked claims with a
 * source extension id is gone.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { claimedWorkspaceIds } from "../lib/services/claimed-workspace-registry";
import {
  workspaces,
  resetWorkspaceStoreForTest,
} from "../lib/stores/workspace";
import type { Workspace } from "../lib/types";

function makeWorkspace(id: string, parentWorkspaceId?: string): Workspace {
  return {
    id,
    name: id,
    splitRoot: {
      type: "pane",
      pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `${id}-p`,
    ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
  };
}

describe("claimedWorkspaceIds", () => {
  beforeEach(() => {
    resetWorkspaceStoreForTest();
  });

  it("starts empty", () => {
    expect(get(claimedWorkspaceIds).size).toBe(0);
  });

  it("contains ids of workspaces with a parentWorkspaceId", () => {
    workspaces.set([
      makeWorkspace("root"),
      makeWorkspace("child-1", "root"),
      makeWorkspace("child-2", "root"),
    ]);
    const ids = get(claimedWorkspaceIds);
    expect(ids.size).toBe(2);
    expect(ids.has("child-1")).toBe(true);
    expect(ids.has("child-2")).toBe(true);
    expect(ids.has("root")).toBe(false);
  });

  it("updates when a workspace gains or loses a parent", () => {
    workspaces.set([makeWorkspace("ws-1")]);
    expect(get(claimedWorkspaceIds).has("ws-1")).toBe(false);

    workspaces.update((list) =>
      list.map((w) =>
        w.id === "ws-1" ? { ...w, parentWorkspaceId: "root" } : w,
      ),
    );
    expect(get(claimedWorkspaceIds).has("ws-1")).toBe(true);

    workspaces.update((list) =>
      list.map((w) => {
        if (w.id !== "ws-1") return w;
        const { parentWorkspaceId: _drop, ...rest } = w;
        return rest as Workspace;
      }),
    );
    expect(get(claimedWorkspaceIds).has("ws-1")).toBe(false);
  });
});
