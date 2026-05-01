import type { ExtensionManifest, ExtensionAPI, WorkspaceRef } from "../api";
import { createNestedWorkspaceFromDef } from "../../lib/services/workspace-service";
import {
  closeAutoDashboardsBySource,
  provisionAutoDashboardsForWorkspace,
} from "../../lib/services/workspace-group-service";
import { getWorkspaces } from "../../lib/stores/workspace-groups";
import { waitRestored } from "../../lib/bootstrap/restore-workspaces";
import ClaudeMark from "./icons/ClaudeMark.svelte";
import UserSettingsPanel from "./components/UserSettingsPanel.svelte";
import ClaudeSettingsWidget from "./components/ClaudeSettingsWidget.svelte";

// --- Manifest ---

export const claudeSettingsManifest: ExtensionManifest = {
  id: "claude-settings",
  name: "Claude Settings",
  version: "0.1.0",
  description:
    "Interactive GUI for ~/.claude/settings.json. TitleBar button shows user-level settings overlay; auto-provisioned group dashboard shows project .claude/ settings with full editing support.",
  entry: "./index.ts",
  included: true,
  permissions: [],
  contributes: {},
};

// --- Registration ---

export function registerClaudeSettingsExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    const openUserSettings = api.registerDashboardWorkspace("user-settings", {
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

    api.registerMarkdownComponent(
      "claude-settings-editor",
      ClaudeSettingsWidget,
    );

    api.registerDashboardContribution({
      id: "claude-settings",
      label: "Claude Settings",
      actionLabel: "Add Claude Settings Dashboard",
      capPerWorkspace: 1,
      autoProvision: true,
      icon: ClaudeMark,
      lockedReason: "Required by Claude Settings extension",
      create: (group) => createClaudeSettingsDashboard(api, group),
    });

    void (async () => {
      await waitRestored();
      for (const group of getWorkspaces()) {
        await provisionAutoDashboardsForWorkspace(group);
      }
    })();
  });

  api.onDeactivate(() => {
    closeAutoDashboardsBySource("claude-settings");
  });
}

// --- Dashboard creation ---

function claudeSettingsMarkdownPath(group: WorkspaceRef): string {
  return `${group.path.replace(/\/+$/, "")}/.gnar-term/claude-settings.md`;
}

async function writeClaudeSettingsTemplate(
  api: ExtensionAPI,
  group: WorkspaceRef,
  options: { force?: boolean } = {},
): Promise<string> {
  const mdPath = claudeSettingsMarkdownPath(group);
  if (!options.force) {
    const exists = await api
      .invoke<boolean>("file_exists", { path: mdPath })
      .catch(() => false);
    if (exists) return mdPath;
  }
  const dir = mdPath.replace(/\/[^/]+$/, "");
  await api.invoke("ensure_dir", { path: dir });
  await api.invoke("write_file", {
    path: mdPath,
    content: "# Claude Settings\n\n```gnar:claude-settings-editor\n```\n",
  });
  return mdPath;
}

async function createClaudeSettingsDashboard(
  api: ExtensionAPI,
  group: WorkspaceRef,
): Promise<string> {
  const mdPath = await writeClaudeSettingsTemplate(api, group);
  return createNestedWorkspaceFromDef({
    name: "Claude Settings",
    layout: {
      pane: {
        surfaces: [
          {
            type: "preview",
            path: mdPath,
            name: "Claude Settings",
            focus: true,
          },
        ],
      },
    },
    metadata: {
      isDashboard: true,
      parentWorkspaceId: group.id,
      dashboardContributionId: "claude-settings",
    },
  });
}
