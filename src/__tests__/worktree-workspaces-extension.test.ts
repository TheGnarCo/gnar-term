/**
 * Tests for the worktree-workspaces extension — only owns the
 * "New Worktree" workspace-action button. Handler delegates to the
 * core `worktrees:create-workspace` command via api.runCommand.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import {
  worktreeWorkspacesManifest,
  registerWorktreeWorkspacesExtension,
} from "../extensions/worktree-workspaces";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../lib/services/extension-loader";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import {
  registerCommand,
  resetCommands,
} from "../lib/services/command-registry";

describe("worktree-workspaces extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetWorkspaceActions();
  });

  it("manifest declares the create-worktree workspace action", () => {
    const actions = worktreeWorkspacesManifest.contributes?.workspaceActions;
    expect(actions).toHaveLength(1);
    expect(actions![0].id).toBe("create-worktree");
    expect(actions![0].title).toBe("New Worktree");
    expect(actions![0].icon).toBe("git-branch");
  });

  it("on activation registers the workspace action with namespaced id", async () => {
    registerExtension(
      worktreeWorkspacesManifest,
      registerWorktreeWorkspacesExtension,
    );
    await activateExtension("worktree-workspaces");

    const action = get(workspaceActionStore).find(
      (a) => a.id === "worktree-workspaces:create-worktree",
    );
    expect(action).toBeTruthy();
    expect(action!.label).toBe("New Worktree");
    expect(action!.icon).toBe("git-branch");
    expect(action!.source).toBe("worktree-workspaces");
  });

  it("when filter shows the action everywhere outside projects, only in git projects", async () => {
    registerExtension(
      worktreeWorkspacesManifest,
      registerWorktreeWorkspacesExtension,
    );
    await activateExtension("worktree-workspaces");

    const action = get(workspaceActionStore).find(
      (a) => a.id === "worktree-workspaces:create-worktree",
    );
    expect(action!.when!({})).toBe(true);
    expect(action!.when!({ groupId: "p-1", isGit: true })).toBe(true);
    expect(action!.when!({ groupId: "p-1", isGit: false })).toBe(false);
  });

  it("handler triggers the core worktrees:create-workspace command, forwarding ctx", async () => {
    const action = vi.fn();
    registerCommand({
      id: "worktrees:create-workspace",
      title: "New Worktree...",
      source: "worktrees",
      action,
    });

    registerExtension(
      worktreeWorkspacesManifest,
      registerWorktreeWorkspacesExtension,
    );
    await activateExtension("worktree-workspaces");

    const ctx = { groupId: "p-1", groupPath: "/p", isGit: true };
    const registered = get(workspaceActionStore).find(
      (a) => a.id === "worktree-workspaces:create-worktree",
    );
    registered!.handler(ctx);

    expect(action).toHaveBeenCalledWith(ctx);
  });

  it("handler is a no-op when the core command is not registered", async () => {
    registerExtension(
      worktreeWorkspacesManifest,
      registerWorktreeWorkspacesExtension,
    );
    await activateExtension("worktree-workspaces");

    const action = get(workspaceActionStore).find(
      (a) => a.id === "worktree-workspaces:create-worktree",
    );
    // Should not throw — runCommand returns false silently
    expect(() => action!.handler({})).not.toThrow();
  });
});
