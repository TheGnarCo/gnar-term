import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import type { Workspace } from "../lib/config";
import { addNestedWorkspaceToWorkspace } from "../lib/services/workspace-group-service";
import { getWorkspaces, setWorkspaces } from "../lib/stores/workspace-groups";
import { nestedWorkspaces } from "../lib/stores/workspace";

describe("Workspace.primaryNestedWorkspaceId", () => {
  it("accepts a group with primaryNestedWorkspaceId set", () => {
    const group: Workspace = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      nestedWorkspaceIds: ["ws-1"],
      primaryNestedWorkspaceId: "ws-1",
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(group.primaryNestedWorkspaceId).toBe("ws-1");
  });

  it("accepts a group without primaryNestedWorkspaceId (legacy shape)", () => {
    const group: Workspace = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      nestedWorkspaceIds: [],
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(group.primaryNestedWorkspaceId).toBeUndefined();
  });
});

describe("addNestedWorkspaceToWorkspace — primary invariant", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    setWorkspaces([
      {
        id: "g1",
        name: "G1",
        path: "/tmp/g1",
        color: "blue",
        nestedWorkspaceIds: ["ws-primary"],
        primaryNestedWorkspaceId: "ws-primary",
        isGit: false,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    ]);
    nestedWorkspaces.set([
      {
        id: "ws-primary",
        name: "Primary",
        layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
        metadata: { parentWorkspaceId: "g1" },
      } as never,
      {
        id: "ws-worktree",
        name: "Worktree",
        layout: { pane: { id: "p2", surfaces: [], activeIdx: 0 } },
        metadata: { parentWorkspaceId: "g1", worktreePath: "/tmp/wt" },
      } as never,
    ]);
  });

  it("allows adding a worktree workspace to a group that already has a primary", () => {
    const changed = addNestedWorkspaceToWorkspace("g1", "ws-worktree");
    expect(changed).toBe(true);
    const group = getWorkspaces().find((g) => g.id === "g1");
    expect(group?.nestedWorkspaceIds).toContain("ws-worktree");
  });

  it("throws when adding a second non-worktree workspace to a group that has a primary", () => {
    nestedWorkspaces.update((list) => [
      ...list,
      {
        id: "ws-second",
        name: "Second",
        layout: { pane: { id: "p3", surfaces: [], activeIdx: 0 } },
        metadata: { parentWorkspaceId: "g1" },
      } as never,
    ]);
    expect(() => addNestedWorkspaceToWorkspace("g1", "ws-second")).toThrow(
      "already has a primary workspace",
    );
  });
});
