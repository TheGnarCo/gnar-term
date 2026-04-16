/**
 * GitHub — included extension
 *
 * Registers a secondary sidebar tab showing GitHub issues, pull requests,
 * and recent git commits for the active workspace's repository.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import GitHubTab from "./GitHubTab.svelte";

export const githubManifest: ExtensionManifest = {
  id: "github",
  name: "GitHub",
  version: "0.1.0",
  description: "GitHub issues, pull requests, and recent commits",
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

export function registerGitHubExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerSecondarySidebarTab("github", GitHubTab);

    // The GitHubTab component stores its refresh function in api.state
    // under the key "github-refresh". The action and command invoke it.
    const triggerRefresh = () => {
      const refresh = api.state.get<() => void>("github-refresh");
      if (refresh) refresh();
    };

    api.registerSecondarySidebarAction("github", "refresh", triggerRefresh);
    api.registerCommand("refresh-github", triggerRefresh);
  });
}
