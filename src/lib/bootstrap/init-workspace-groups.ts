/**
 * Workspace Groups bootstrap — core's counterpart to the deleted
 * project-scope extension (Stage 5). Registers the commands, workspace
 * action, root-row renderer, overlay, and Dashboard contribution that
 * let users create and manage Workspace Groups.
 *
 * Called after the core event bus, claimed-workspace registry, and
 * workspaces store are live, and after included extensions register
 * (so registration order matches the previous extension-activation
 * behavior).
 */
import { get } from "svelte/store";
import { registerCommand } from "../services/command-registry";
import { registerWorkspaceAction } from "../services/workspace-action-registry";
import { registerRootRowRenderer } from "../services/root-row-renderer-registry";
import { registerDashboardContribution } from "../services/dashboard-contribution-registry";
import { eventBus, type AppEvent } from "../services/event-bus";
import { appendRootRow } from "../stores/root-row-order";
import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
import {
  loadWorkspaceGroups,
  getWorkspaceGroups as readGroups,
  getActiveGroupId,
  setActiveGroupId,
} from "../stores/workspace-groups";
import {
  addWorkspaceGroup,
  addWorkspaceToGroup,
  claimWorkspace,
  createGroupDashboardWorkspace,
  createSettingsDashboardWorkspace,
  isDashboardWorkspace,
  openGroupDashboard,
  provisionAutoDashboardsForGroup,
  reclaimWorkspacesAcrossGroups,
  regenerateGroupDashboardTemplate,
  removeWorkspaceFromAllGroups,
  unclaimWorkspace,
  updateWorkspaceGroup,
} from "../services/workspace-group-service";
import { resolveProjectColor } from "../theme-data";
import { theme } from "../stores/theme";
import WorkspaceGroupRowBody from "../components/WorkspaceGroupRowBody.svelte";
import GearIcon from "../icons/GearIcon.svelte";
import GridIcon from "../icons/GridIcon.svelte";
import type { WorkspaceGroupEntry } from "../config";
import {
  pendingCreateResolver,
  createDialogPrefill,
} from "../stores/workspace-groups-ui";
import { invoke } from "@tauri-apps/api/core";
import { getActiveCwd } from "../services/service-helpers";
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
  const metadata = event.metadata as Record<string, unknown> | undefined;
  const targetGroupId = metadata?.groupId as string | undefined;
  if (!targetGroupId) return;
  addWorkspaceToGroup(targetGroupId, event.id);
  claimWorkspace(event.id, SOURCE);
}

function onWorkspaceClosed(event: AppEvent): void {
  if (event.type !== "workspace:closed") return;
  removeWorkspaceFromAllGroups(event.id);
  unclaimWorkspace(event.id);
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
  const group: WorkspaceGroupEntry = {
    id,
    name: result.name,
    path: result.path,
    color: result.color,
    workspaceIds: [],
    isGit,
    createdAt: new Date().toISOString(),
  };

  addWorkspaceGroup(group);

  // Auto-provision every autoProvision dashboard contribution for the
  // new group (group Overview, Settings, and any extension-owned
  // autoProvision contributions like Agentic). The Overview dashboard
  // is tracked via `group.dashboardWorkspaceId` so `openGroupDashboard`
  // can activate it directly; the helper returns its id when the
  // contribution's source is core + id is "group".
  try {
    await provisionAutoDashboardsForGroup(group);
    const overview = get(workspaces).find((w) =>
      isDashboardWorkspace(w, group.id, "group"),
    );
    if (overview) {
      updateWorkspaceGroup(id, { dashboardWorkspaceId: overview.id });
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
    const newWs = get(workspaces)
      .slice()
      .reverse()
      .find(
        (w) =>
          (w.metadata as Record<string, unknown> | undefined)?.groupId === id &&
          !(w.metadata as Record<string, unknown> | undefined)?.isDashboard,
      );
    if (newWs) {
      const idx = get(workspaces).indexOf(newWs);
      if (idx >= 0) switchWorkspace(idx);
    }
  } catch (err) {
    console.error(
      `[workspace-groups] Failed to spawn initial workspace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  setActiveGroupId(id);
  return id;
}

/**
 * Promote the active, ungrouped workspace into a new workspace group
 * rooted at that workspace's current working directory. Opens the
 * create dialog with path/name pre-filled, then moves the workspace
 * into the created group.
 */
async function promoteActiveWorkspaceToGroup(): Promise<void> {
  const list = get(workspaces);
  const idx = get(activeWorkspaceIdx);
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
  addWorkspaceToGroup(newGroupId, activeWs.id);
  claimWorkspace(activeWs.id, SOURCE);
}

/**
 * Register one palette command per group — "<group>: New Workspace".
 * Re-run whenever groups change so added groups get their commands.
 */
function registerPerGroupCommands(): void {
  for (const group of readGroups()) {
    registerCommand({
      id: `new-ws-${group.id}`,
      title: `${group.name}: New Workspace`,
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
  await loadWorkspaceGroups();

  // Seed rootRowOrder with each existing group. appendRootRow is
  // idempotent, so a persisted order is preserved.
  for (const group of readGroups()) {
    appendRootRow({ kind: "workspace-group", id: group.id });
  }

  // Re-claim any restored workspaces that belong to a known group —
  // workspace ids change on every restart, so the workspaceIds list is
  // rebuilt from metadata.groupId on each workspace.
  reclaimWorkspacesAcrossGroups();

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
      return resolveProjectColor(group.color, get(theme));
    },
    label: (id: string) => readGroups().find((g) => g.id === id)?.name,
  });

  // Workspace action — appears in the Workspaces header "+ New"
  // split-button dropdown alongside "New Workspace".
  registerWorkspaceAction({
    id: "new-workspace-group",
    label: "New Workspace Group...",
    icon: "folder-plus",
    source: SOURCE,
    // Workspace Groups nest workspaces, not other groups. Hide the
    // action from any context that carries a groupId (e.g. a group's
    // banner context menu, a group-nested "+ New" dropdown) so users
    // can't try to create a group inside a group.
    when: (ctx) => !ctx?.groupId,
    handler: () => {
      void createWorkspaceGroupFlow();
    },
  });

  // Commands
  registerCommand({
    id: "create-workspace-group",
    title: "Create Workspace Group...",
    source: SOURCE,
    action: () => {
      void createWorkspaceGroupFlow();
    },
  });

  registerCommand({
    id: "promote-workspace-to-group",
    title: "Promote Workspace to Workspace Group...",
    source: SOURCE,
    action: () => {
      void promoteActiveWorkspaceToGroup();
    },
  });

  registerCommand({
    id: "open-group-dashboard",
    title: "Open Workspace Group Dashboard...",
    source: SOURCE,
    action: () => {
      const groups = readGroups();
      if (groups.length === 0) return;
      const activeId = getActiveGroupId();
      const group = activeId
        ? groups.find((g) => g.id === activeId)
        : groups[0];
      if (!group) return;
      void openGroupDashboard(group);
    },
  });

  // Surfaced in PaneView's TabBar for workspaces belonging to a group.
  registerCommand({
    id: "workspace-groups:regenerate-active-group-dashboard",
    title: "Spawn Workspace Group Dashboard",
    source: SOURCE,
    action: () => {
      const list = get(workspaces);
      const idx = get(activeWorkspaceIdx);
      const ws = typeof idx === "number" ? list[idx] : undefined;
      const md = ws?.metadata as Record<string, unknown> | undefined;
      const groupId = md?.groupId;
      if (typeof groupId !== "string") return;
      const group = readGroups().find((g) => g.id === groupId);
      if (group) void openGroupDashboard(group);
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
    create: async (group: WorkspaceGroupEntry) =>
      await createGroupDashboardWorkspace(group),
    regenerate: async (group: WorkspaceGroupEntry) =>
      await regenerateGroupDashboardTemplate(group),
  });

  // Core-internal "Settings" contribution — id `settings`,
  // autoProvision. Hosts the per-group dashboard toggles + name /
  // color picker. PaneView renders GroupDashboardSettings in place of
  // the surface list for workspaces carrying this contribution id.
  registerDashboardContribution({
    id: "settings",
    source: "core",
    label: "Settings",
    actionLabel: "Add Settings Dashboard",
    capPerGroup: 1,
    autoProvision: true,
    icon: GearIcon,
    lockedReason: "Required (Settings)",
    create: async (group: WorkspaceGroupEntry) =>
      await createSettingsDashboardWorkspace(group),
  });

  eventBus.on("workspace:created", onWorkspaceCreated);
  eventBus.on("workspace:closed", onWorkspaceClosed);
}
