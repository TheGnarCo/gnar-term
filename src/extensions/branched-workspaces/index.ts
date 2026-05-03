/**
 * Branched Workspaces — included extension
 *
 * Gates all branched workspace creation affordances behind an opt-in
 * extension. When active, registers the Branch tile action (appears on
 * git-backed workspace rows via the "workspace-tile" zone), a palette
 * command, and per-workspace palette commands.
 *
 * Workspace creation via worktrees delegates to the core worktree-service;
 * the service and lifecycle events remain in core so existing branches are
 * always operable regardless of extension state.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import { createWorktreeWorkspace } from "../../lib/services/worktree-service";
import { createNestedWorkspaceFromDef } from "../../lib/services/nested-workspace-service";
import { getWorkspaces } from "../../lib/stores/workspaces";

export const branchedWorkspacesManifest: ExtensionManifest = {
  id: "branched-workspaces",
  name: "Branched Workspaces",
  version: "0.1.0",
  description:
    "Enables creating new branched workspaces. Adds the Branch tile to git-backed workspace rows and palette commands.",
  entry: "./index.ts",
  included: true,
  contributes: {
    workspaceActions: [
      {
        id: "branched-workspaces:branch",
        title: "Branch Workspace",
        icon: "git-branch",
        zone: "workspace-tile",
      },
    ],
    commands: [
      { id: "branched-workspaces:create", title: "Branch Workspace..." },
    ],
  },
};

export function registerBranchedWorkspacesExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerWorkspaceAction("branched-workspaces:branch", {
      label: "Branch Workspace",
      icon: "git-branch",
      zone: "workspace-tile",
      when: (ctx) => ctx.isGit === true,
      handler: (ctx) => {
        void createWorktreeWorkspace(ctx as Record<string, unknown>);
      },
    });

    api.registerCommand(
      "branched-workspaces:create",
      () => {
        void createWorktreeWorkspace({});
      },
      { title: "Branch Workspace..." },
    );

    for (const workspace of getWorkspaces()) {
      api.registerCommand(
        `new-ws-${workspace.id}`,
        () => {
          const count =
            getWorkspaces().find((w) => w.id === workspace.id)
              ?.nestedWorkspaceIds.length ?? 0;
          void createNestedWorkspaceFromDef({
            name: `${workspace.name} Branch ${count + 1}`,
            cwd: workspace.path,
            metadata: { parentWorkspaceId: workspace.id },
            layout: { pane: { surfaces: [{ type: "terminal" }] } },
          });
        },
        { title: `${workspace.name}: New Branched Workspace` },
      );
    }
  });
}
