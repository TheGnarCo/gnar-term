import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import type { WorkspaceGroupEntry } from "../lib/config";

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
    // Type check: verify the field exists in the type definition
    const _: string | undefined = group.primaryWorkspaceId;
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
    // Type check: verify the field is optional
    const _: string | undefined = group.primaryWorkspaceId;
  });
});
