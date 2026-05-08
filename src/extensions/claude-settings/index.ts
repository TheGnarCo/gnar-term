import type { ExtensionManifest, ExtensionAPI } from "../api";
import type { Component } from "svelte";
import ClaudeMark from "./icons/ClaudeMark.svelte";
import UserSettingsPanel from "./components/UserSettingsPanel.svelte";
import ClaudeSettingsBody from "./components/ClaudeSettingsBody.svelte";
import {
  registerGlobalSurface,
  unregisterGlobalSurface,
  globalSurfaceTypeId,
} from "../../lib/services/global-surface-service";

// --- Manifest ---

export const claudeSettingsManifest: ExtensionManifest = {
  id: "claude-settings",
  name: "Claude Settings",
  version: "0.1.0",
  description:
    "Interactive GUI for ~/.claude/settings.json. TitleBar button shows user-level settings overlay; auto-provisioned workspace dashboard shows project .claude/ settings with full editing support.",
  entry: "./index.ts",
  included: true,
  permissions: ["filesystem"],
  contributes: {},
};

// --- Registration ---

export function registerClaudeSettingsExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    const openUserSettings = api.registerGlobalSurface("user-settings", {
      label: "Claude Settings",
      icon: ClaudeMark,
      component: UserSettingsPanel,
      accentColor: "#D97757",
    });

    api.registerTitleBarButton("claude-settings", {
      icon: ClaudeMark,
      title: "Claude Settings",
      onClick: openUserSettings,
    });

    registerGlobalSurface({
      id: "claude-settings",
      label: "Claude Settings",
      icon: ClaudeMark as unknown as Component,
      component: ClaudeSettingsBody as unknown as Component,
      source: "claude-settings",
    });

    api.registerDashboardContribution({
      id: "claude-settings",
      label: "Claude Settings",
      actionLabel: "Add Claude Settings Dashboard",
      capPerWorkspace: 1,
      icon: ClaudeMark,
      openAsTab: async (workspace, opts) => {
        await api.openDashboardTab(
          workspace.id,
          {
            kind: "registry",
            surfaceTypeId: globalSurfaceTypeId("claude-settings"),
            title: "Claude Settings",
            props: { rootWorkspaceId: workspace.id },
            matchProps: { rootWorkspaceId: workspace.id },
            dashboardContributionId: "claude-settings",
          },
          opts,
        );
      },
    });
  });

  api.onDeactivate(() => {
    unregisterGlobalSurface("claude-settings");
  });
}
