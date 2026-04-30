/**
 * reconcilePrimaryWorkspaces — startup pass that:
 *   1. Backfills primaryWorkspaceId on groups that lack it.
 *   2. Wraps standalone (ungrouped) workspaces into new groups.
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

import { workspaces } from "../lib/stores/workspace";
import {
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import { reconcilePrimaryWorkspaces } from "../lib/services/workspace-group-service";
import type { WorkspaceEntry } from "../lib/config";

function makeGroup(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    id: "g1",
    name: "Group 1",
    path: "/tmp/g1",
    color: "blue",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function makeWorkspace(id: string, overrides: Record<string, unknown> = {}) {
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
    workspaces.set([]);
    setWorkspaceGroups([]);
  });

  it("backfills primaryWorkspaceId on a group that lacks it", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["ws-1"] });
    setWorkspaceGroups([group]);
    workspaces.set([makeWorkspace("ws-1", { metadata: { groupId: "g1" } })]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-1");
  });

  it("skips groups that already have primaryWorkspaceId", async () => {
    const group = makeGroup({
      id: "g1",
      workspaceIds: ["ws-1"],
      primaryWorkspaceId: "ws-1",
    });
    setWorkspaceGroups([group]);
    workspaces.set([makeWorkspace("ws-1", { metadata: { groupId: "g1" } })]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-1");
    // No duplicate groups created
    expect(getWorkspaceGroups()).toHaveLength(1);
  });

  it("skips worktree workspaces when choosing primary", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["wt-1", "ws-2"] });
    setWorkspaceGroups([group]);
    workspaces.set([
      makeWorkspace("wt-1", {
        metadata: { groupId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeWorkspace("ws-2", { metadata: { groupId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-2");
  });

  it("skips dashboard workspaces when choosing primary", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["dash-1", "ws-2"] });
    setWorkspaceGroups([group]);
    workspaces.set([
      makeWorkspace("dash-1", {
        metadata: { groupId: "g1", isDashboard: true },
      }),
      makeWorkspace("ws-2", { metadata: { groupId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-2");
  });

  it("wraps a standalone workspace into a new group", async () => {
    workspaces.set([makeWorkspace("ws-solo", { name: "Solo", metadata: {} })]);

    await reconcilePrimaryWorkspaces();

    const groups = getWorkspaceGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryWorkspaceId).toBe("ws-solo");
    expect(groups[0].name).toBe("Solo");

    // Workspace is now stamped with groupId
    const ws = get(workspaces).find((w) => w.id === "ws-solo");
    expect((ws?.metadata as Record<string, unknown>)?.groupId).toBe(
      groups[0].id,
    );
  });

  it("does not wrap dashboard workspaces", async () => {
    workspaces.set([
      makeWorkspace("dash-global", { metadata: { isDashboard: true } }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaceGroups()).toHaveLength(0);
  });

  it("is idempotent — calling twice does not double-wrap", async () => {
    workspaces.set([makeWorkspace("ws-solo", { name: "Solo", metadata: {} })]);

    await reconcilePrimaryWorkspaces();
    await reconcilePrimaryWorkspaces();

    expect(getWorkspaceGroups()).toHaveLength(1);
  });

  it("does not wrap orphan worktree workspaces (standalone with worktreePath set)", async () => {
    workspaces.set([
      makeWorkspace("wt-orphan", {
        metadata: { worktreePath: "/tmp/wt-orphan" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaceGroups()).toHaveLength(0);
  });

  it("wraps a workspace with an orphaned (unknown) groupId into a new group", async () => {
    workspaces.set([
      makeWorkspace("ws-orphan-group", {
        metadata: { groupId: "deleted-group-id" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const groups = getWorkspaceGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryWorkspaceId).toBe("ws-orphan-group");

    const ws = get(workspaces).find((w) => w.id === "ws-orphan-group");
    expect((ws?.metadata as Record<string, unknown>)?.groupId).toBe(
      groups[0].id,
    );
  });

  it("leaves primaryWorkspaceId unset on a group with only ineligible members (all worktrees)", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["wt-1", "wt-2"] });
    setWorkspaceGroups([group]);
    workspaces.set([
      makeWorkspace("wt-1", {
        metadata: { groupId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeWorkspace("wt-2", {
        metadata: { groupId: "g1", worktreePath: "/tmp/wt2" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBeUndefined();
    expect(getWorkspaceGroups()).toHaveLength(1);
  });
});
