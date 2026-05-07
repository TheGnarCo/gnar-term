/**
 * Invariant: a Branch never becomes a Root. The presence of
 * `Workspace.rootWorkspaceId` marks a runtime workspace as a Branch
 * for life. Startup reconciliation must skip orphan Branches —
 * runtime workspaces tagged with a `rootWorkspaceId` whose target is
 * missing — instead of promoting them to Roots.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { get } from "svelte/store";
import {
  workspaces,
  resetWorkspaceStoreForTest,
  resetWorkspacesForTest,
  getWorkspaces,
} from "../lib/stores/workspace";
import { reconcilePrimaryWorkspaces } from "../lib/services/workspace-service";

describe("Branch → Root invariant", () => {
  beforeEach(() => {
    resetWorkspaceStoreForTest();
    resetWorkspacesForTest();
  });

  it("orphan Branch with no worktreePath is NOT promoted to a Root", async () => {
    workspaces.set([
      {
        id: "ws-orphan-branch",
        name: "Orphan",
        paneLayout: { type: "pane", pane: { id: "p", surfaces: [] } },
        activePaneId: "p",
        rootWorkspaceId: "missing-root",
      },
    ] as never);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces().map((w) => w.id)).toEqual([]);
    const runtime = get(workspaces).find((w) => w.id === "ws-orphan-branch");
    expect(runtime?.rootWorkspaceId).toBe("missing-root");
  });

  it("standalone runtime workspace with no rootWorkspaceId IS promoted", async () => {
    workspaces.set([
      {
        id: "ws-standalone",
        name: "Standalone",
        paneLayout: { type: "pane", pane: { id: "p", surfaces: [] } },
        activePaneId: "p",
      },
    ] as never);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces().map((w) => w.id)).toEqual(["ws-standalone"]);
  });

  it("attached Branch (rootWorkspaceId resolves) is NOT promoted", async () => {
    workspaces.set([
      {
        id: "ws-root",
        name: "Root",
        path: "/root",
        color: "#fff",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-05-06T00:00:00.000Z",
      },
      {
        id: "ws-branch",
        name: "Branch",
        paneLayout: { type: "pane", pane: { id: "p", surfaces: [] } },
        activePaneId: "p",
        rootWorkspaceId: "ws-root",
      },
    ] as never);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaces().map((w) => w.id)).toEqual(["ws-root"]);
  });
});
