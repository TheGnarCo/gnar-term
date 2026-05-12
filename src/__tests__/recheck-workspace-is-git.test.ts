/**
 * Regression tests for `recheckWorkspaceIsGit` and the
 * `workspace:activated` handler in init-workspaces.
 *
 * Bug: when a user ran `git init` inside an existing workspace, the
 * sidebar banner didn't pick up the new git state. The root cause was
 * (a) `onWorkspaceActivated` returned early when the activated
 * workspace itself was the root (no `rootWorkspaceId`), and (b) no
 * trigger re-ran `is_git_repo` after creation. The fix exposes
 * `recheckWorkspaceIsGit` and wires it to activation, window focus,
 * and a 5s poll on the active workspace.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { recheckWorkspaceIsGit } from "../lib/bootstrap/init-workspaces";
import {
  workspaces,
  resetWorkspacesForTest,
  setWorkspaces,
} from "../lib/stores/workspace";
import type { RootWorkspace } from "../lib/stores/workspace";

function makeRoot(overrides: Partial<RootWorkspace> = {}): RootWorkspace {
  return {
    id: "root-1",
    name: "Root",
    path: "/repos/root",
    color: "blue",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-01-01",
    paneLayout: {
      type: "pane",
      pane: { id: "p1", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p1",
    ...overrides,
  } as RootWorkspace;
}

describe("recheckWorkspaceIsGit", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    invokeMock.mockReset();
  });

  it("updates isGit when is_git_repo flips false → true", async () => {
    const ws = makeRoot({ isGit: false });
    setWorkspaces([ws]);
    invokeMock.mockResolvedValueOnce(true);

    await recheckWorkspaceIsGit(ws.id);

    expect(invokeMock).toHaveBeenCalledWith("is_git_repo", {
      path: "/repos/root",
    });
    const updated = get(workspaces).find((w) => w.id === ws.id);
    expect(updated?.isGit).toBe(true);
  });

  it("updates isGit when is_git_repo flips true → false (`.git` removed)", async () => {
    const ws = makeRoot({ isGit: true });
    setWorkspaces([ws]);
    invokeMock.mockResolvedValueOnce(false);

    await recheckWorkspaceIsGit(ws.id);

    const updated = get(workspaces).find((w) => w.id === ws.id);
    expect(updated?.isGit).toBe(false);
  });

  it("is a no-op when the workspace's isGit already matches", async () => {
    const ws = makeRoot({ isGit: true });
    setWorkspaces([ws]);
    invokeMock.mockResolvedValueOnce(true);

    const before = get(workspaces).find((w) => w.id === ws.id);
    await recheckWorkspaceIsGit(ws.id);
    const after = get(workspaces).find((w) => w.id === ws.id);

    // No mutation → identity preserved (updateWorkspace returns a new
    // array reference, so we check field equality instead).
    expect(after?.isGit).toBe(before?.isGit);
  });

  it("silently no-ops when the workspace id does not exist", async () => {
    await recheckWorkspaceIsGit("missing");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("silently swallows an invoke rejection (e.g. path gone)", async () => {
    const ws = makeRoot({ isGit: true });
    setWorkspaces([ws]);
    invokeMock.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(recheckWorkspaceIsGit(ws.id)).resolves.toBeUndefined();

    const updated = get(workspaces).find((w) => w.id === ws.id);
    expect(updated?.isGit).toBe(true);
  });
});
