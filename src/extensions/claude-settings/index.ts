import { writable } from "svelte/store";
import type {
  ExtensionManifest,
  ExtensionAPI,
  WorkspaceGroupRef,
} from "../api";
import { createWorkspaceFromDef } from "../../lib/services/workspace-service";
import {
  closeAutoDashboardsBySource,
  provisionAutoDashboardsForGroup,
} from "../../lib/services/workspace-group-service";
import { getWorkspaceGroups } from "../../lib/stores/workspace-groups";
import { waitRestored } from "../../lib/bootstrap/restore-workspaces";
import ClaudeIcon from "./icons/ClaudeIcon.svelte";
import UserSettingsOverlay from "./components/UserSettingsOverlay.svelte";
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
  // Module-level store — shared between TitleBar button isActive and overlay props.
  const userSettingsVisible = writable(false);

  api.onActivate(() => {
    api.registerTitleBarButton("claude-settings", {
      icon: ClaudeIcon,
      title: "Claude Settings",
      isActive: userSettingsVisible,
      onClick: () => userSettingsVisible.update((v) => !v),
    });

    api.registerOverlay("claude-settings:user-settings", UserSettingsOverlay, {
      visibleStore: userSettingsVisible,
    });

    api.registerMarkdownComponent(
      "claude-settings-editor",
      ClaudeSettingsWidget,
    );

    api.registerDashboardContribution({
      id: "claude-settings",
      label: "Claude Settings",
      actionLabel: "Add Claude Settings Dashboard",
      capPerGroup: 1,
      autoProvision: true,
      icon: ClaudeIcon,
      lockedReason: "Required by Claude Settings extension",
      create: (group) => createClaudeSettingsDashboard(api, group),
    });

    void (async () => {
      await waitRestored();
      for (const group of getWorkspaceGroups()) {
        await provisionAutoDashboardsForGroup(group);
      }
    })();
  });

  api.onDeactivate(() => {
    userSettingsVisible.set(false);
    closeAutoDashboardsBySource("claude-settings");
  });
}

// --- Dashboard creation ---

function claudeSettingsMarkdownPath(group: WorkspaceGroupRef): string {
  return `${group.path.replace(/\/+$/, "")}/.gnar-term/claude-settings.md`;
}

async function writeClaudeSettingsTemplate(
  api: ExtensionAPI,
  group: WorkspaceGroupRef,
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
  group: WorkspaceGroupRef,
): Promise<string> {
  const mdPath = await writeClaudeSettingsTemplate(api, group);
  return createWorkspaceFromDef({
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
      groupId: group.id,
      dashboardContributionId: "claude-settings",
    },
  });
}
