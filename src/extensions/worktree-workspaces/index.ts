/**
 * Worktree Workspaces — included extension
 *
 * Owns ONLY the user-facing "New Worktree" workspace-action button.
 * Core owns the worktree-workspace concept (data model, lifecycle,
 * settings, archive/merge commands, visual treatment) — this extension
 * just exposes the trigger control. The handler delegates to the core
 * `worktrees:create-workspace` command via api.runCommand, passing the
 * action context through so project-aware behavior is preserved.
 *
 * Disabling the extension hides the button; the create flow is still
 * reachable via the command palette.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";

export const worktreeWorkspacesManifest: ExtensionManifest = {
  id: "worktree-workspaces",
  name: "Worktree Workspaces",
  version: "0.1.0",
  description: "Adds the New Worktree workspace-action button",
  entry: "./index.ts",
  included: true,
  contributes: {
    workspaceActions: [
      {
        id: "create-worktree",
        title: "New Worktree",
        icon: "git-branch",
      },
    ],
  },
};

export function registerWorktreeWorkspacesExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerWorkspaceAction("create-worktree", {
      label: "New Worktree",
      icon: "git-branch",
      handler: (ctx) => {
        api.runCommand("worktrees:create-workspace", ctx);
      },
      when: (ctx) => {
        if (!ctx.projectId) return true;
        return ctx.isGit === true;
      },
    });
  });
}
