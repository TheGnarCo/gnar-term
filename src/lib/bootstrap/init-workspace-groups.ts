/**
 * Workspace Groups bootstrap — core's counterpart to the deleted
 * project-scope extension (Stage 5). Registers the commands, workspace
 * action, root-row renderer, overlay, and Dashboard contribution that
 * let users create and manage Workspace Groups.
 *
 * Called after the core event bus, claimed-workspace registry, and
 * nestedWorkspaces store are live, and after included extensions register
 * (so registration order matches the previous extension-activation
 * behavior).
 */
import { get } from "svelte/store";
import { registerCommand, runCommandById } from "../services/command-registry";
import { registerWorkspaceAction } from "../services/workspace-action-registry";
import { registerRootRowRenderer } from "../services/root-row-renderer-registry";
import { registerDashboardContribution } from "../services/dashboard-contribution-registry";
import { eventBus, type AppEvent } from "../services/event-bus";
import { appendRootRow } from "../stores/root-row-order";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../stores/workspace";
import {
  loadWorkspaces,
  getWorkspaces as readGroups,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "../stores/workspace-groups";
import {
  addWorkspace,
  addNestedWorkspaceToWorkspace,
  claimWorkspace,
  createGroupDashboardWorkspace,
  createSettingsDashboardWorkspace,
  isDashboardWorkspace,
  openWorkspaceDashboard,
  provisionAutoDashboardsForWorkspace,
  reclaimNestedWorkspacesAcrossWorkspaces,
  regenerateGroupDashboardTemplate,
  removeNestedWorkspaceFromAllWorkspaces,
  unclaimWorkspace,
  updateWorkspace,
} from "../services/workspace-group-service";
import { resolveGroupColor } from "../theme-data";
import { theme } from "../stores/theme";
import WorkspaceGroupRowBody from "../components/WorkspaceGroupRowBody.svelte";
import GearIcon from "../icons/GearIcon.svelte";
import GridIcon from "../icons/GridIcon.svelte";
import WorkspacesWidget from "../components/WorkspacesWidget.svelte";
import { registerMarkdownComponent } from "../services/markdown-component-registry";
import type { Workspace } from "../config";
import {
  pendingCreateResolver,
  createDialogPrefill,
} from "../stores/workspace-groups-ui";
import { invoke } from "@tauri-apps/api/core";
import { getActiveCwd, wsMeta } from "../services/service-helpers";
import type { NestedWorkspaceMetadata } from "../types";
import {
  createWorkspaceFromDef,
  switchWorkspace,
} from "../services/workspace-service";

/**
 * Stage 5 moved Workspace Groups out of the extension layer and into
 * core, alongside Workspaces. Registry contributions (commands,
 * workspace actions, root-row renderers, dashboard contributions) stamp
 * their origin under the shared `"core"` source so extensions that
 * unregister themselves by source can't sweep core contributions, and
 * so `ExtensionWrapper` can look up a single shared `"core"` API when
 * mounting core-owned components.
 */
const SOURCE = "core";

function generateId(): string {
  return crypto.randomUUID();
}

function onWorkspaceCreated(event: AppEvent): void {
  if (event.type !== "workspace:created") return;
  const metadata = event.metadata as NestedWorkspaceMetadata | undefined;
  const targetGroupId = metadata?.groupId;
  if (!targetGroupId) return;
  addNestedWorkspaceToWorkspace(targetGroupId, event.id);
  claimWorkspace(event.id, SOURCE);
}

function onWorkspaceClosed(event: AppEvent): void {
  if (event.type !== "workspace:closed") return;
  removeNestedWorkspaceFromAllWorkspaces(event.id);
  unclaimWorkspace(event.id);
}

function onWorkspaceActivated(event: AppEvent): void {
  if (event.type !== "workspace:activated") return;
  const ws = get(nestedWorkspaces).find((w) => w.id === event.id);
  if (!ws) return;
  const groupId = wsMeta(ws).groupId;
  if (typeof groupId !== "string") return;
  const group = readGroups().find((g) => g.id === groupId);
  if (!group) return;
  void invoke<boolean>("is_git_repo", { path: group.path })
    .then((isGit) => {
      if (isGit !== group.isGit) {
        updateWorkspace(groupId, { isGit });
      }
    })
    .catch(() => {});
}

/**
 * Open the create dialog and wait for the user to submit or cancel.
 * Resolves to the dialog's values on submit, null on cancel.
 */
function openCreateDialog(prefill?: {
  path: string;
  name?: string;
}): Promise<{ name: string; path: string; color: string } | null> {
  createDialogPrefill.set(prefill ?? null);
  return new Promise((resolve) => {
    pendingCreateResolver.set((result) => {
      pendingCreateResolver.set(null);
      resolve(result);
    });
  });
}

/**
 * Drive the full create flow: open the dialog, persist the group, and
 * spawn the group's Dashboard workspace. Returns the new group id on
 * success, null on cancel.
 */
async function createWorkspaceGroupFlow(prefill?: {
  path: string;
  name?: string;
}): Promise<string | null> {
  const result = await openCreateDialog(prefill);
  if (!result) return null;

  let isGit = false;
  try {
    isGit = await invoke<boolean>("is_git_repo", { path: result.path });
  } catch {
    // Not a git repo or path doesn't exist
  }

  const id = generateId();
  const group: Workspace = {
    id,
    name: result.name,
    path: result.path,
    color: result.color,
    workspaceIds: [],
    isGit,
    createdAt: new Date().toISOString(),
  };

  addWorkspace(group);

  // Auto-provision every autoProvision dashboard contribution for the
  // new group (group Overview, Settings, and any extension-owned
  // autoProvision contributions like Agentic). The Overview dashboard
  // is tracked via `group.dashboardWorkspaceId` so `openWorkspaceDashboard`
  // can activate it directly; the helper returns its id when the
  // contribution's source is core + id is "group".
  try {
    await provisionAutoDashboardsForWorkspace(group);
    const overview = get(nestedWorkspaces).find((w) =>
      isDashboardWorkspace(w, group.id, "group"),
    );
    if (overview) {
      updateWorkspace(id, { dashboardWorkspaceId: overview.id });
    }
  } catch (err) {
    console.error(
      `[workspace-groups] Failed to auto-provision dashboards: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Spawn an initial regular workspace inside the new group and activate
  // it. The workspace:created handler claims it into the group
  // automatically when it sees metadata.groupId.
  try {
    const wsCount =
      readGroups().find((g) => g.id === id)?.workspaceIds.length ?? 0;
    await createWorkspaceFromDef({
      name: `${result.name} Workspace ${wsCount + 1}`,
      cwd: result.path,
      metadata: { groupId: id },
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    });
    const newWs = get(nestedWorkspaces)
      .slice()
      .reverse()
      .find((w) => wsMeta(w).groupId === id && !wsMeta(w).isDashboard);
    if (newWs) {
      updateWorkspace(id, { primaryWorkspaceId: newWs.id });
      const idx = get(nestedWorkspaces).indexOf(newWs);
      if (idx >= 0) switchWorkspace(idx);
    }
  } catch (err) {
    console.error(
      `[workspace-groups] Failed to spawn initial workspace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  setActiveWorkspaceId(id);
  return id;
}

/**
 * Promote the active, ungrouped workspace into a new workspace group
 * rooted at that workspace's current working directory. Opens the
 * create dialog with path/name pre-filled, then moves the workspace
 * into the created group.
 */
async function promoteActiveWorkspaceToGroup(): Promise<void> {
  const list = get(nestedWorkspaces);
  const idx = get(activeNestedWorkspaceIdx);
  const activeWs = typeof idx === "number" ? list[idx] : undefined;
  if (!activeWs) return;

  // getActiveCwd observes the shell's OSC 7 signal — more accurate than
  // whatever was persisted.
  const cwd = (await getActiveCwd()) || (activeWs as { cwd?: string }).cwd;
  if (!cwd) {
    console.warn(
      "[workspace-groups] Cannot promote — unknown working directory",
    );
    return;
  }

  const derivedName = cwd.replace(/\/+$/, "").split("/").pop() || activeWs.name;

  const newGroupId = await createWorkspaceGroupFlow({
    path: cwd,
    name: derivedName,
  });
  if (!newGroupId) return;

  // Move the workspace into the new group. workspace:created already
  // fired at creation time, so replay the claim bookkeeping manually.
  addNestedWorkspaceToWorkspace(newGroupId, activeWs.id);
  claimWorkspace(activeWs.id, SOURCE);
}

/**
 * Register one palette command per group — "<group>: New NestedWorkspace".
 * Re-run whenever groups change so added groups get their commands.
 */
function registerPerGroupCommands(): void {
  for (const group of readGroups()) {
    registerCommand({
      id: `new-ws-${group.id}`,
      title: `${group.name}: New NestedWorkspace`,
      source: SOURCE,
      action: () => {
        const count =
          readGroups().find((g) => g.id === group.id)?.workspaceIds.length ?? 0;
        void createWorkspaceFromDef({
          name: `${group.name} Workspace ${count + 1}`,
          cwd: group.path,
          metadata: { groupId: group.id },
          layout: { pane: { surfaces: [{ type: "terminal" }] } },
        });
      },
    });
  }
}

export async function initWorkspaceGroups(): Promise<void> {
  await loadWorkspaces();

  // Seed rootRowOrder with each existing group. appendRootRow is
  // idempotent, so a persisted order is preserved.
  for (const group of readGroups()) {
    appendRootRow({ kind: "workspace-group", id: group.id });
  }

  // Re-claim any restored nestedWorkspaces that belong to a known group —
  // workspace ids change on every restart, so the workspaceIds list is
  // rebuilt from metadata.groupId on each workspace.
  reclaimNestedWorkspacesAcrossWorkspaces();

  registerPerGroupCommands();

  // Root-row renderer for "workspace-group" kind. ContainerRow inside
  // the renderer owns the grip/banner/nested-list chrome; the rail
  // color + label resolvers let the outer list paint the grip in the
  // group's color and show its name in the drag overlay.
  registerRootRowRenderer({
    id: "workspace-group",
    source: SOURCE,
    component: WorkspaceGroupRowBody,
    railColor: (id: string) => {
      const group = readGroups().find((g) => g.id === id);
      if (!group) return undefined;
      return resolveGroupColor(group.color, get(theme));
    },
    label: (id: string) => readGroups().find((g) => g.id === id)?.name,
  });

  // Formerly owned by the worktree-nestedWorkspaces extension. Registered here
  // so the action is available in context menus on git-backed groups. The
  // ⎇ Branch button in WorkspaceSectionContent calls the command
  // directly; this action surfaces it in the workspace action registry.
  registerWorkspaceAction({
    id: "core:create-worktree",
    label: "⎇ Branch",
    icon: "git-branch",
    source: SOURCE,
    when: (ctx) => !!ctx?.groupId && ctx.isGit === true,
    handler: (ctx) => {
      runCommandById("worktrees:create-workspace", ctx);
    },
  });

  // Commands
  registerCommand({
    id: "create-workspace-group",
    title: "Create Workspace...",
    source: SOURCE,
    action: () => {
      void createWorkspaceGroupFlow();
    },
  });

  registerCommand({
    id: "promote-workspace-to-group",
    title: "Promote NestedWorkspace to Workspace...",
    source: SOURCE,
    action: () => {
      void promoteActiveWorkspaceToGroup();
    },
  });

  registerCommand({
    id: "open-group-dashboard",
    title: "Open Workspace Dashboard...",
    source: SOURCE,
    action: () => {
      const groups = readGroups();
      if (groups.length === 0) return;
      const activeId = getActiveWorkspaceId();
      const group = activeId
        ? groups.find((g) => g.id === activeId)
        : groups[0];
      if (!group) return;
      void openWorkspaceDashboard(group);
    },
  });

  // Surfaced in PaneView's TabBar for nestedWorkspaces belonging to a group.
  registerCommand({
    id: "workspace-groups:regenerate-active-group-dashboard",
    title: "Spawn Workspace Dashboard",
    source: SOURCE,
    action: () => {
      const list = get(nestedWorkspaces);
      const idx = get(activeNestedWorkspaceIdx);
      const ws = typeof idx === "number" ? list[idx] : undefined;
      const groupId = ws ? wsMeta(ws).groupId : undefined;
      if (typeof groupId !== "string") return;
      const group = readGroups().find((g) => g.id === groupId);
      if (group) void openWorkspaceDashboard(group);
    },
  });

  // Core-internal "Group Dashboard" contribution — id `group`,
  // capPerGroup 1, autoProvision. Materializes the per-group Overview
  // workspace. `lockedReason` surfaces in the Settings dashboard's
  // toggle list explaining why the toggle is fixed-on.
  registerDashboardContribution({
    id: "group",
    source: "core",
    label: "Group Dashboard",
    actionLabel: "Add Group Dashboard",
    capPerGroup: 1,
    autoProvision: true,
    icon: GridIcon,
    lockedReason: "Required (Overview)",
    create: async (group: Workspace) =>
      await createGroupDashboardWorkspace(group),
    regenerate: async (group: Workspace) =>
      await regenerateGroupDashboardTemplate(group),
  });

  // Core-internal "Settings" contribution — id `settings`,
  // autoProvision. Hosts the per-group dashboard toggles + name /
  // color picker. PaneView renders GroupDashboardSettings in place of
  // the surface list for nestedWorkspaces carrying this contribution id.
  registerDashboardContribution({
    id: "settings",
    source: "core",
    label: "Settings",
    actionLabel: "Add Settings Dashboard",
    capPerGroup: 1,
    autoProvision: true,
    icon: GearIcon,
    lockedReason: "Required (Settings)",
    create: async (group: Workspace) =>
      await createSettingsDashboardWorkspace(group),
  });

  eventBus.on("workspace:created", onWorkspaceCreated);
  eventBus.on("workspace:closed", onWorkspaceClosed);
  eventBus.on("workspace:activated", onWorkspaceActivated);

  registerMarkdownComponent({
    name: "workspaces",
    component: WorkspacesWidget,
    source: SOURCE,
  });
}
