/**
 * Tests for initWorktrees() — verifies the bootstrap registers the
 * workspace action and commands, and that workspace lifecycle event
 * handlers behave correctly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const settingsRef = { current: {} as Record<string, unknown> };
vi.mock("../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/config")>();
  return {
    ...actual,
    getConfig: () => ({
      worktrees: { entries: [], settings: settingsRef.current },
    }),
    saveConfig: vi.fn().mockResolvedValue(undefined),
  };
});

import { initWorktrees } from "../lib/bootstrap/init-worktrees";
import { commandStore, resetCommands } from "../lib/services/command-registry";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import {
  _resetWorktreeService,
  _seedWorktreeEntries,
  getWorktreeEntries,
  getWorktreeSettings,
  handleWorkspaceCreated,
} from "../lib/services/worktree-service";
import { eventBus } from "../lib/services/event-bus";

describe("initWorktrees()", () => {
  beforeEach(() => {
    resetCommands();
    resetWorkspaceActions();
    _resetWorktreeService();
    settingsRef.current = {};
  });

  it("registers create-workspace command", () => {
    initWorktrees();
    const cmd = get(commandStore).find(
      (c) => c.id === "worktrees:create-workspace",
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("New Worktree...");
    expect(cmd!.source).toBe("worktrees");
  });

  it("does NOT register the workspace action — that lives in the worktree-workspaces extension", () => {
    initWorktrees();
    const action = get(workspaceActionStore).find(
      (a) => a.id === "core:create-worktree-workspace",
    );
    expect(action).toBeUndefined();
  });

  it("registers archive-workspace command", () => {
    initWorktrees();
    const cmd = get(commandStore).find(
      (c) => c.id === "worktrees:archive-workspace",
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Archive Worktree...");
    expect(cmd!.source).toBe("worktrees");
  });

  it("registers merge-archive-workspace command", () => {
    initWorktrees();
    const cmd = get(commandStore).find(
      (c) => c.id === "worktrees:merge-archive-workspace",
    );
    expect(cmd).toBeTruthy();
    expect(cmd!.title).toBe("Merge & Archive Worktree...");
    expect(cmd!.source).toBe("worktrees");
  });

  it("workspace:created event captures workspaceId for matching entry", () => {
    initWorktrees();
    _seedWorktreeEntries([
      {
        worktreePath: "/repo-feat",
        branch: "feat",
        baseBranch: "main",
        repoPath: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    eventBus.emit({
      type: "workspace:created",
      id: "ws-1",
      name: "Worktree 1",
      metadata: { worktreePath: "/repo-feat" },
    });

    const entries = getWorktreeEntries();
    expect(entries[0].workspaceId).toBe("ws-1");
  });

  it("workspace:created with non-matching path leaves entries untouched", () => {
    initWorktrees();
    _seedWorktreeEntries([
      {
        worktreePath: "/repo-feat",
        branch: "feat",
        baseBranch: "main",
        repoPath: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    handleWorkspaceCreated("ws-other", { worktreePath: "/some/other" });

    expect(getWorktreeEntries()[0].workspaceId).toBeUndefined();
  });
});

describe("Worktree settings defaults", () => {
  beforeEach(() => {
    settingsRef.current = {};
  });

  it("returns an empty object when no settings are configured", () => {
    expect(getWorktreeSettings()).toEqual({});
  });

  it("reads settings from config.worktrees.settings", () => {
    settingsRef.current = {
      branchPrefix: "feat/",
      copyPatterns: ".env",
      setupScript: "npm install",
      mergeStrategy: "squash",
    };
    expect(getWorktreeSettings()).toEqual({
      branchPrefix: "feat/",
      copyPatterns: ".env",
      setupScript: "npm install",
      mergeStrategy: "squash",
    });
  });
});
