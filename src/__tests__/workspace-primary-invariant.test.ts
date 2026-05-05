import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import type { Workspace } from "../lib/config";
import { addChildToWorkspace } from "../lib/services/workspace-service";
import { getWorkspaces, setWorkspaces } from "../lib/stores/workspace";
import { workspaces } from "../lib/stores/workspace";

describe("Workspace.primaryBranchedWorkspaceId", () => {
  it("accepts a workspace with primaryBranchedWorkspaceId set", () => {
    const workspace: Workspace = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      branchedWorkspaceIds: ["ws-1"],
      primaryBranchedWorkspaceId: "ws-1",
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(workspace.primaryBranchedWorkspaceId).toBe("ws-1");
  });

  it("accepts a workspace without primaryBranchedWorkspaceId (legacy shape)", () => {
    const workspace: Workspace = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      branchedWorkspaceIds: [],
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(workspace.primaryBranchedWorkspaceId).toBeUndefined();
  });
});

describe("addChildToWorkspace — primary invariant", () => {
  beforeEach(() => {
    workspaces.set([]);
    setWorkspaces([
      {
        id: "g1",
        name: "G1",
        path: "/tmp/g1",
        color: "blue",
        branchedWorkspaceIds: ["ws-primary"],
        primaryBranchedWorkspaceId: "ws-primary",
        isGit: false,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    ]);
    workspaces.set([
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

  it("allows adding a worktree child workspace to a workspace that already has a primary", () => {
    const changed = addChildToWorkspace("g1", "ws-worktree");
    expect(changed).toBe(true);
    const workspace = getWorkspaces().find((g) => g.id === "g1");
    expect(workspace?.branchedWorkspaceIds).toContain("ws-worktree");
  });

  it("throws when adding a second non-worktree child workspace to a workspace that has a primary", () => {
    workspaces.update((list) => [
      ...list,
      {
        id: "ws-second",
        name: "Second",
        layout: { pane: { id: "p3", surfaces: [], activeIdx: 0 } },
        metadata: { parentWorkspaceId: "g1" },
      } as never,
    ]);
    expect(() => addChildToWorkspace("g1", "ws-second")).toThrow(
      "already has a primary workspace",
    );
  });
});
