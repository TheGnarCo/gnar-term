/**
 * Diff Viewer — included extension
 *
 * Registers a "diff" surface type for rendering unified git diffs,
 * plus commands for showing uncommitted changes and comparing branches.
 */
import type { ExtensionManifest, ExtensionAPI, WorkspaceRef } from "../api";
import type { Component } from "svelte";
import DiffSurface from "./DiffSurface.svelte";
import DiffDashboardBody from "./DiffDashboardBody.svelte";
import DiffIcon from "./DiffIcon.svelte";
import { createWorkspaceFromDef } from "../../lib/services/workspace-runtime-service";
import {
  registerDashboardWorkspaceType,
  unregisterDashboardWorkspaceType,
} from "../../lib/services/dashboard-workspace-service";

export const diffViewerManifest: ExtensionManifest = {
  id: "diff-viewer",
  name: "Diff Viewer",
  version: "0.1.0",
  description: "View git diffs with syntax highlighting",
  entry: "./index.ts",
  included: true,
  contributes: {
    surfaces: [{ id: "diff", label: "Diff" }],
    commands: [
      { id: "show-uncommitted", title: "Show Uncommitted Changes" },
      { id: "show-staged", title: "Show Staged Changes" },
      { id: "diff-file", title: "Diff File..." },
      { id: "compare-branches", title: "Compare Branches..." },
    ],
    contextMenuItems: [{ id: "diff-file", label: "Show Diff", when: "*" }],
    events: ["workspace:activated"],
  },
};

export function registerDiffViewerExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Diffs need a commit / branch context — can't open from "+" click.
    api.registerSurfaceType("diff", DiffSurface, { hideFromNewSurface: true });

    api.registerCommand("show-uncommitted", async () => {
      const cwd = await api.getActiveCwd();
      if (!cwd) return;
      // `git diff HEAD` includes staged + unstaged changes. Plain
      // `git diff` only shows unstaged, which disagreed with the
      // sidebar's "N modified" count (from `git status`) whenever the
      // user had `git add`-ed any of the modified files — the Diff
      // surface would render "No changes" despite the banner count.
      api.openSurface("diff", "Uncommitted Changes", {
        repoPath: cwd,
        baseBranch: "HEAD",
      });
    });

    api.registerCommand("show-staged", async () => {
      const cwd = await api.getActiveCwd();
      if (!cwd) return;
      api.openSurface("diff", "Staged Changes", {
        repoPath: cwd,
        staged: true,
      });
    });

    api.registerCommand("diff-file", async () => {
      const cwd = await api.getActiveCwd();
      if (!cwd) return;
      const filePath = await api.showInputPrompt("File path");
      if (!filePath) return;
      const name = filePath.split("/").pop() || "Diff";
      api.openSurface("diff", name, {
        repoPath: cwd,
        filePath,
      });
    });

    api.registerCommand("compare-branches", async () => {
      const cwd = await api.getActiveCwd();
      if (!cwd) return;
      const base = await api.showInputPrompt("Base branch", "main");
      if (!base) return;
      const compare = await api.showInputPrompt("Compare branch", "HEAD");
      if (!compare) return;
      api.openSurface("diff", `${base}..${compare}`, {
        repoPath: cwd,
        baseBranch: base,
        compareBranch: compare,
      });
    });

    api.registerContextMenuItem("diff-file", async (filePath: string) => {
      const cwd = await api.getActiveCwd();
      if (!cwd) return;
      const name = filePath.split("/").pop() || "Diff";
      api.openSurface("diff", name, {
        repoPath: cwd,
        filePath,
      });
    });

    // Diff dashboard contribution — opt-in per Workspace. The dashboard
    // workspace is a routing-only Branch (no surfaces); PaneView renders
    // DiffDashboardBody, which mounts DiffSurface against the workspace's repo.
    registerDashboardWorkspaceType({
      id: "diff",
      label: "Diff",
      icon: DiffIcon as unknown as Component,
      component: DiffDashboardBody as unknown as Component,
      source: "diff-viewer",
    });
    api.registerDashboardContribution({
      id: "diff",
      label: "Diff",
      actionLabel: "Add Diff Dashboard",
      capPerWorkspace: 1,
      icon: DiffIcon,
      defaultEnabled: true,
      create: (workspace) => createDiffDashboardWorkspace(workspace),
    });
  });

  api.onDeactivate(() => {
    unregisterDashboardWorkspaceType("diff");
  });
}

/**
 * Materialize a Diff dashboard workspace for `workspace` — a routing-only
 * Branch with no surfaces. PaneView intercepts and renders
 * DiffDashboardBody for any workspace whose `dashboardContributionId === "diff"`.
 */
async function createDiffDashboardWorkspace(
  workspace: WorkspaceRef,
): Promise<string> {
  return await createWorkspaceFromDef({
    name: "Diff",
    layout: { pane: { surfaces: [] } },
    isDashboard: true,
    rootWorkspaceId: workspace.id,
    dashboardContributionId: "diff",
  });
}
