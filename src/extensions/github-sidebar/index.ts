/**
 * GitHub Sidebar — included extension
 *
 * Owns ONLY the secondary sidebar tab that surfaces GitHub issues, PRs,
 * and recent commits for the active workspace. Does NOT own GitHub
 * integration as a concept — the PR/CI badge in the workspace subtitle
 * (which uses the gh CLI for PR review and check status) lives in core
 * and keeps working when this extension is disabled.
 *
 * The refresh action and palette command are also extension-owned: they
 * trigger the live tab component's refetch via api.state, where the tab
 * stashes its refresh function in onMount and clears it in onDestroy.
 * Both action and command are safe no-ops when no tab is mounted.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import GitHubTab from "./GitHubTab.svelte";

export const githubSidebarManifest: ExtensionManifest = {
  id: "github-sidebar",
  name: "GitHub Sidebar",
  version: "0.1.0",
  description: "Secondary sidebar tab for GitHub issues, PRs, and commits",
  entry: "./index.ts",
  included: true,
  contributes: {
    secondarySidebarTabs: [
      {
        id: "github",
        label: "GitHub",
        icon: "github",
        actions: [{ id: "refresh", icon: "refresh", title: "Refresh" }],
      },
    ],
    commands: [{ id: "refresh-github", title: "Refresh GitHub Data" }],
  },
};

export function registerGitHubSidebarExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerSecondarySidebarTab("github", GitHubTab);

    const triggerRefresh = () => {
      api.state.get<(() => void) | null>("refresh")?.();
    };

    api.registerSecondarySidebarAction("github", "refresh", triggerRefresh);
    api.registerCommand("refresh-github", triggerRefresh);
  });
}
