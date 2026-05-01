import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import type { Workspace } from "../lib/config";
import { addWorkspaceToGroup } from "../lib/services/workspace-group-service";
import {
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import { workspaces } from "../lib/stores/workspace";

describe("Workspace.primaryWorkspaceId", () => {
  it("accepts a group with primaryWorkspaceId set", () => {
    const group: Workspace = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      workspaceIds: ["ws-1"],
      primaryWorkspaceId: "ws-1",
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(group.primaryWorkspaceId).toBe("ws-1");
  });

  it("accepts a group without primaryWorkspaceId (legacy shape)", () => {
    const group: Workspace = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      workspaceIds: [],
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(group.primaryWorkspaceId).toBeUndefined();
  });
});

describe("addWorkspaceToGroup — primary invariant", () => {
  beforeEach(() => {
    workspaces.set([]);
    setWorkspaceGroups([
      {
        id: "g1",
        name: "G1",
        path: "/tmp/g1",
        color: "blue",
        workspaceIds: ["ws-primary"],
        primaryWorkspaceId: "ws-primary",
        isGit: false,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      {
        id: "ws-primary",
        name: "Primary",
        layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
        metadata: { groupId: "g1" },
      } as never,
      {
        id: "ws-worktree",
        name: "Worktree",
        layout: { pane: { id: "p2", surfaces: [], activeIdx: 0 } },
        metadata: { groupId: "g1", worktreePath: "/tmp/wt" },
      } as never,
    ]);
  });

  it("allows adding a worktree workspace to a group that already has a primary", () => {
    const changed = addWorkspaceToGroup("g1", "ws-worktree");
    expect(changed).toBe(true);
    const group = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(group?.workspaceIds).toContain("ws-worktree");
  });

  it("throws when adding a second non-worktree workspace to a group that has a primary", () => {
    workspaces.update((list) => [
      ...list,
      {
        id: "ws-second",
        name: "Second",
        layout: { pane: { id: "p3", surfaces: [], activeIdx: 0 } },
        metadata: { groupId: "g1" },
      } as never,
    ]);
    expect(() => addWorkspaceToGroup("g1", "ws-second")).toThrow(
      "already has a primary workspace",
    );
  });
});
