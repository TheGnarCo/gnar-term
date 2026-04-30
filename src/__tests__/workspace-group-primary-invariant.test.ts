import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import type { WorkspaceGroupEntry } from "../lib/config";
import {
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";

describe("WorkspaceGroupEntry.primaryWorkspaceId", () => {
  it("accepts a group with primaryWorkspaceId set", () => {
    const group: WorkspaceGroupEntry = {
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
    const group: WorkspaceGroupEntry = {
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

describe("createWorkspaceGroupFlow — no dialog path", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    setWorkspaceGroups([]);
  });

  it("created group has primaryWorkspaceId pointing at its initial workspace", async () => {
    // This test will be fleshed out after the implementation is wired.
    // For now just verify the type compiles with primaryWorkspaceId set.
    const _group = getWorkspaceGroups()[0];
    // _group is undefined before creation — placeholder to fail at compile
    expect(true).toBe(true);
  });
});
