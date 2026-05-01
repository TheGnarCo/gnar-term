/**
 * reconcilePrimaryWorkspaces — startup pass that:
 *   1. Backfills primaryNestedWorkspaceId on groups that lack it.
 *   2. Wraps standalone (ungrouped) nestedWorkspaces into new groups.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "is_git_repo") return false;
    return undefined;
  }),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { nestedWorkspaces } from "../lib/stores/nested-workspace";
import { getWorkspaces, setWorkspaces } from "../lib/stores/workspaces";
import { reconcilePrimaryWorkspaces } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "g1",
    name: "Group 1",
    path: "/tmp/g1",
    color: "blue",
    nestedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function makeNestedWorkspace(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name: `Workspace ${id}`,
    layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
    metadata: {},
    ...overrides,
  } as never;
}

describe("reconcilePrimaryWorkspaces", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    setWorkspaces([]);
  });

  it("backfills primaryNestedWorkspaceId on a group that lacks it", async () => {
    const group = makeWorkspace({ id: "g1", nestedWorkspaceIds: ["ws-1"] });
    setWorkspaces([group]);
    nestedWorkspaces.set([
      makeNestedWorkspace("ws-1", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryNestedWorkspaceId).toBe("ws-1");
  });

  it("skips groups that already have primaryNestedWorkspaceId", async () => {
    const group = makeWorkspace({
      id: "g1",
      nestedWorkspaceIds: ["ws-1"],
      primaryNestedWorkspaceId: "ws-1",
    });
    setWorkspaces([group]);
    nestedWorkspaces.set([
      makeNestedWorkspace("ws-1", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryNestedWorkspaceId).toBe("ws-1");
    // No duplicate groups created
    expect(getWorkspaces()).toHaveLength(1);
  });

  it("skips worktree nestedWorkspaces when choosing primary", async () => {
    const group = makeWorkspace({
      id: "g1",
      nestedWorkspaceIds: ["wt-1", "ws-2"],
    });
    setWorkspaces([group]);
    nestedWorkspaces.set([
      makeNestedWorkspace("wt-1", {
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeNestedWorkspace("ws-2", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryNestedWorkspaceId).toBe("ws-2");
  });

  it("skips dashboard nestedWorkspaces when choosing primary", async () => {
    const group = makeWorkspace({
      id: "g1",
      nestedWorkspaceIds: ["dash-1", "ws-2"],
    });
    setWorkspaces([group]);
    nestedWorkspaces.set([
      makeNestedWorkspace("dash-1", {
        metadata: { parentWorkspaceId: "g1", isDashboard: true },
      }),
      makeNestedWorkspace("ws-2", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryNestedWorkspaceId).toBe("ws-2");
  });

  it("wraps a standalone workspace into a new group", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("ws-solo", { name: "Solo", metadata: {} }),
    ]);

    await reconcilePrimaryWorkspaces();

    const groups = getWorkspaces();
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryNestedWorkspaceId).toBe("ws-solo");
    expect(groups[0].name).toBe("Solo");

    // NestedWorkspace is now stamped with parentWorkspaceId
    const ws = get(nestedWorkspaces).find((w) => w.id === "ws-solo");
    expect((ws?.metadata as Record<string, unknown>)?.parentWorkspaceId).toBe(
      groups[0].id,
    );
  });

  it("does not wrap dashboard nestedWorkspaces", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("dash-global", { metadata: { isDashboard: true } }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces()).toHaveLength(0);
  });

  it("is idempotent — calling twice does not double-wrap", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("ws-solo", { name: "Solo", metadata: {} }),
    ]);

    await reconcilePrimaryWorkspaces();
    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces()).toHaveLength(1);
  });

  it("does not wrap orphan worktree nestedWorkspaces (standalone with worktreePath set)", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("wt-orphan", {
        metadata: { worktreePath: "/tmp/wt-orphan" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces()).toHaveLength(0);
  });

  it("wraps a workspace with an orphaned (unknown) parentWorkspaceId into a new group", async () => {
    nestedWorkspaces.set([
      makeNestedWorkspace("ws-orphan-group", {
        metadata: { parentWorkspaceId: "deleted-group-id" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const groups = getWorkspaces();
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryNestedWorkspaceId).toBe("ws-orphan-group");

    const ws = get(nestedWorkspaces).find((w) => w.id === "ws-orphan-group");
    expect((ws?.metadata as Record<string, unknown>)?.parentWorkspaceId).toBe(
      groups[0].id,
    );
  });

  it("leaves primaryNestedWorkspaceId unset on a group with only ineligible members (all worktrees)", async () => {
    const group = makeWorkspace({
      id: "g1",
      nestedWorkspaceIds: ["wt-1", "wt-2"],
    });
    setWorkspaces([group]);
    nestedWorkspaces.set([
      makeNestedWorkspace("wt-1", {
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeNestedWorkspace("wt-2", {
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt2" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryNestedWorkspaceId).toBeUndefined();
    expect(getWorkspaces()).toHaveLength(1);
  });
});
