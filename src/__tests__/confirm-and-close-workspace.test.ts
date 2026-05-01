/**
 * Tests for confirmAndCloseWorkspace — the dialog-gated close path used by
 * the X button, ⇧⌘W, and the extension API's close-workspace pendingAction.
 *
 * Verifies that:
 *   - Regular nestedWorkspaces show a confirm prompt before closing
 *   - Cancelling the prompt does NOT close the workspace
 *   - Dashboard nestedWorkspaces close without a prompt
 *   - Worktree nestedWorkspaces show the keep/delete form prompt
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

const mockShowConfirmPrompt = vi.fn<() => Promise<boolean>>();
const mockShowFormPrompt =
  vi.fn<() => Promise<Record<string, string> | null>>();
vi.mock("../lib/stores/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/stores/ui")>();
  return {
    ...actual,
    showConfirmPrompt: (...args: unknown[]) => mockShowConfirmPrompt(...args),
    showFormPrompt: (...args: unknown[]) => mockShowFormPrompt(...args),
  };
});

const mockCloseWorkspace = vi.fn<(idx: number) => void>();
vi.mock("../lib/services/workspace-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/services/workspace-service")>();
  return {
    ...actual,
    closeNestedWorkspace: (idx: number) => mockCloseWorkspace(idx),
  };
});

vi.mock("../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/config")>();
  return {
    ...actual,
    getConfig: () => ({ worktrees: { entries: [] } }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  confirmAndCloseWorkspace,
  _resetWorktreeService,
  _seedWorktreeEntries,
} from "../lib/services/worktree-service";

describe("confirmAndCloseWorkspace", () => {
  beforeEach(() => {
    _resetWorktreeService();
    mockShowConfirmPrompt.mockReset();
    mockShowFormPrompt.mockReset();
    mockCloseWorkspace.mockReset();
  });

  it("shows a confirm prompt for a plain (non-worktree, non-dashboard) workspace", async () => {
    mockShowConfirmPrompt.mockResolvedValue(true);
    const ws = { id: "ws-1", name: "My Workspace" };
    await confirmAndCloseWorkspace(ws, 0);
    expect(mockShowConfirmPrompt).toHaveBeenCalledOnce();
  });

  it("closes the workspace when the user confirms", async () => {
    mockShowConfirmPrompt.mockResolvedValue(true);
    const ws = { id: "ws-1", name: "My Workspace" };
    const result = await confirmAndCloseWorkspace(ws, 2);
    expect(result).toBe(true);
    expect(mockCloseWorkspace).toHaveBeenCalledWith(2);
  });

  it("does NOT close when the user cancels the confirm prompt", async () => {
    mockShowConfirmPrompt.mockResolvedValue(false);
    const ws = { id: "ws-1", name: "My Workspace" };
    const result = await confirmAndCloseWorkspace(ws, 0);
    expect(result).toBe(false);
    expect(mockCloseWorkspace).not.toHaveBeenCalled();
  });

  it("closes a dashboard workspace without showing any prompt", async () => {
    const ws = {
      id: "ws-dash",
      name: "Dashboard",
      metadata: { dashboardWorkspaceId: "some-id" },
    };
    const result = await confirmAndCloseWorkspace(ws, 1);
    expect(result).toBe(true);
    expect(mockShowConfirmPrompt).not.toHaveBeenCalled();
    expect(mockShowFormPrompt).not.toHaveBeenCalled();
    expect(mockCloseWorkspace).toHaveBeenCalledWith(1);
  });

  it("shows the worktree keep/delete form for a worktree workspace", async () => {
    _seedWorktreeEntries([
      {
        worktreePath: "/repo/feat",
        branch: "feat",
        baseBranch: "main",
        repoPath: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        workspaceId: "ws-wt",
      },
    ]);
    mockShowFormPrompt.mockResolvedValue({
      action: "keep",
      path: "/repo/feat",
    });
    const ws = { id: "ws-wt", name: "Worktree feat" };
    const result = await confirmAndCloseWorkspace(ws, 3);
    expect(result).toBe(true);
    expect(mockShowConfirmPrompt).not.toHaveBeenCalled();
    expect(mockShowFormPrompt).toHaveBeenCalledOnce();
    expect(mockCloseWorkspace).toHaveBeenCalledWith(3);
  });

  it("refuses to close a locked workspace without prompting", async () => {
    const ws = {
      id: "ws-locked",
      name: "Locked Workspace",
      metadata: { locked: true },
    };
    const result = await confirmAndCloseWorkspace(ws, 0);
    expect(result).toBe(false);
    expect(mockShowConfirmPrompt).not.toHaveBeenCalled();
    expect(mockShowFormPrompt).not.toHaveBeenCalled();
    expect(mockCloseWorkspace).not.toHaveBeenCalled();
  });

  it("refuses to close a locked worktree workspace without showing the form", async () => {
    _seedWorktreeEntries([
      {
        worktreePath: "/repo/feat",
        branch: "feat",
        baseBranch: "main",
        repoPath: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        workspaceId: "ws-wt-locked",
      },
    ]);
    const ws = {
      id: "ws-wt-locked",
      name: "Worktree feat",
      metadata: { locked: true },
    };
    const result = await confirmAndCloseWorkspace(ws, 0);
    expect(result).toBe(false);
    expect(mockShowFormPrompt).not.toHaveBeenCalled();
    expect(mockCloseWorkspace).not.toHaveBeenCalled();
  });

  it("does NOT close when user cancels the worktree form", async () => {
    _seedWorktreeEntries([
      {
        worktreePath: "/repo/feat",
        branch: "feat",
        baseBranch: "main",
        repoPath: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        workspaceId: "ws-wt",
      },
    ]);
    mockShowFormPrompt.mockResolvedValue(null);
    const ws = { id: "ws-wt", name: "Worktree feat" };
    const result = await confirmAndCloseWorkspace(ws, 0);
    expect(result).toBe(false);
    expect(mockCloseWorkspace).not.toHaveBeenCalled();
  });
});
