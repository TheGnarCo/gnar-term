/**
 * Diff Viewer — included extension
 *
 * Registers a "diff" surface type for rendering unified git diffs,
 * plus commands for showing uncommitted changes and comparing branches.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import DiffSurface from "./DiffSurface.svelte";
import ChangesTab from "./ChangesTab.svelte";

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
    secondarySidebarTabs: [
      {
        id: "changes",
        label: "Changes",
        icon: "diff",
        actions: [{ id: "refresh", icon: "refresh", title: "Refresh" }],
      },
    ],
    settings: {
      fields: {
        diffMode: {
          type: "select",
          title: "Diff Display Mode",
          default: "unified",
          options: [
            { label: "Unified", value: "unified" },
            { label: "Side by Side", value: "side-by-side" },
          ],
        },
        contextLines: {
          type: "number",
          title: "Context Lines",
          description: "Number of context lines around each change",
          default: 3,
        },
        ignoreWhitespace: {
          type: "boolean",
          title: "Ignore Whitespace",
          description: "Exclude whitespace-only changes from diffs",
          default: false,
        },
      },
    },
    events: ["workspace:activated", "worktree:merged"],
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

    // Changes sidebar tab
    api.registerSecondarySidebarTab("changes", ChangesTab);

    const triggerChangesRefresh = () => {
      const refresh = api.state.get<() => void>("changes-refresh");
      if (refresh) refresh();
    };
    api.registerSecondarySidebarAction(
      "changes",
      "refresh",
      triggerChangesRefresh,
    );

    // Auto-open Changes tab when a worktree merge completes
    api.on("worktree:merged", () => {
      api.badgeSidebarTab("changes", true);
      api.activateSidebarTab("changes");
    });
  });
}
