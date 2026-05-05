/**
 * reconcilePrimaryWorkspaces — startup pass that:
 *   1. Backfills primaryBranchedWorkspaceId on workspaces that lack it.
 *   2. Wraps standalone (rootless) workspaces into new workspaces.
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
import { getWorkspaces, setWorkspaces } from "../lib/stores/workspaces";
import { reconcilePrimaryWorkspaces } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "g1",
    name: "Workspace 1",
    path: "/tmp/g1",
    color: "blue",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function makeChildWorkspace(
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
    workspaces.set([]);
    setWorkspaces([]);
  });

  it("backfills primaryBranchedWorkspaceId on a workspace that lacks it", async () => {
    const workspace = makeWorkspace({
      id: "g1",
      branchedWorkspaceIds: ["ws-1"],
    });
    setWorkspaces([workspace]);
    workspaces.set([
      makeChildWorkspace("ws-1", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryBranchedWorkspaceId).toBe("ws-1");
  });

  it("skips workspaces that already have primaryBranchedWorkspaceId", async () => {
    const workspace = makeWorkspace({
      id: "g1",
      branchedWorkspaceIds: ["ws-1"],
      primaryBranchedWorkspaceId: "ws-1",
    });
    setWorkspaces([workspace]);
    workspaces.set([
      makeChildWorkspace("ws-1", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryBranchedWorkspaceId).toBe("ws-1");
    // No duplicate workspaces created
    expect(getWorkspaces()).toHaveLength(1);
  });

  it("skips branched workspaces when choosing primary", async () => {
    const workspace = makeWorkspace({
      id: "g1",
      branchedWorkspaceIds: ["wt-1", "ws-2"],
    });
    setWorkspaces([workspace]);
    workspaces.set([
      makeChildWorkspace("wt-1", {
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeChildWorkspace("ws-2", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryBranchedWorkspaceId).toBe("ws-2");
  });

  it("skips dashboard workspaces when choosing primary", async () => {
    const workspace = makeWorkspace({
      id: "g1",
      branchedWorkspaceIds: ["dash-1", "ws-2"],
    });
    setWorkspaces([workspace]);
    workspaces.set([
      makeChildWorkspace("dash-1", {
        metadata: { parentWorkspaceId: "g1", isDashboard: true },
      }),
      makeChildWorkspace("ws-2", { metadata: { parentWorkspaceId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryBranchedWorkspaceId).toBe("ws-2");
  });

  it("wraps a standalone child workspace into a new workspace", async () => {
    workspaces.set([
      makeChildWorkspace("ws-solo", { name: "Solo", metadata: {} }),
    ]);

    await reconcilePrimaryWorkspaces();

    const primaryWorkspaces = getWorkspaces();
    expect(primaryWorkspaces).toHaveLength(1);
    expect(primaryWorkspaces[0].primaryBranchedWorkspaceId).toBe("ws-solo");
    expect(primaryWorkspaces[0].name).toBe("Solo");

    // Workspace is now stamped with parentWorkspaceId
    const ws = get(workspaces).find((w) => w.id === "ws-solo");
    expect((ws?.metadata as Record<string, unknown>)?.parentWorkspaceId).toBe(
      primaryWorkspaces[0].id,
    );
  });

  it("does not wrap dashboard workspaces", async () => {
    workspaces.set([
      makeChildWorkspace("dash-global", { metadata: { isDashboard: true } }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces()).toHaveLength(0);
  });

  it("is idempotent — calling twice does not double-wrap", async () => {
    workspaces.set([
      makeChildWorkspace("ws-solo", { name: "Solo", metadata: {} }),
    ]);

    await reconcilePrimaryWorkspaces();
    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces()).toHaveLength(1);
  });

  it("does not wrap orphan branched workspaces (standalone with worktreePath set)", async () => {
    workspaces.set([
      makeChildWorkspace("wt-orphan", {
        metadata: { worktreePath: "/tmp/wt-orphan" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces()).toHaveLength(0);
  });

  it("wraps a child workspace with an orphaned (unknown) parentWorkspaceId into a new workspace", async () => {
    workspaces.set([
      makeChildWorkspace("ws-orphan-workspace", {
        metadata: { parentWorkspaceId: "deleted-workspace-id" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const primaryWorkspaces = getWorkspaces();
    expect(primaryWorkspaces).toHaveLength(1);
    expect(primaryWorkspaces[0].primaryBranchedWorkspaceId).toBe(
      "ws-orphan-workspace",
    );

    const ws = get(workspaces).find((w) => w.id === "ws-orphan-workspace");
    expect((ws?.metadata as Record<string, unknown>)?.parentWorkspaceId).toBe(
      primaryWorkspaces[0].id,
    );
  });

  it("wraps a standalone child workspace with no cwd using ~ as default path", async () => {
    workspaces.set([
      makeChildWorkspace("ws-no-cwd", {
        name: "No CWD",
        metadata: {},
        // cwd intentionally absent from metadata
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const primaryWorkspaces = getWorkspaces();
    expect(primaryWorkspaces).toHaveLength(1);
    expect(primaryWorkspaces[0].path).toBe("~");
  });

  it("uses the child workspace's cwd when present", async () => {
    workspaces.set([
      makeChildWorkspace("ws-with-cwd", {
        name: "With CWD",
        metadata: { cwd: "/home/user/projects/myapp" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const primaryWorkspaces = getWorkspaces();
    expect(primaryWorkspaces).toHaveLength(1);
    expect(primaryWorkspaces[0].path).toBe("/home/user/projects/myapp");
  });

  it("leaves primaryBranchedWorkspaceId unset on a workspace with only ineligible members (all worktrees)", async () => {
    const workspace = makeWorkspace({
      id: "g1",
      branchedWorkspaceIds: ["wt-1", "wt-2"],
    });
    setWorkspaces([workspace]);
    workspaces.set([
      makeChildWorkspace("wt-1", {
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeChildWorkspace("wt-2", {
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt2" },
      }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaces().find((g) => g.id === "g1");
    expect(updated?.primaryBranchedWorkspaceId).toBeUndefined();
    expect(getWorkspaces()).toHaveLength(1);
  });
});
