/**
 * Workspaces bootstrap — core's counterpart to the deleted
 * project-scope extension (Stage 5). Registers the commands, workspace
 * action, root-row renderer, overlay, and Dashboard contribution that
 * let users create and manage Workspaces.
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
import {
  registerDashboardContribution,
  OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
} from "../services/dashboard-contribution-registry";
import { eventBus, type AppEvent } from "../services/event-bus";
import { appendRootRow } from "../stores/root-row-order";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../stores/nested-workspace";
import {
  loadWorkspaces,
  getWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "../stores/workspaces";
import {
  addWorkspace,
  addNestedWorkspaceToWorkspace,
  claimWorkspace,
  createWorkspaceDashboardNestedWorkspace,
  createSettingsDashboardWorkspace,
  isDashboardWorkspace,
  openWorkspaceDashboard,
  provisionAutoDashboardsForWorkspace,
  reclaimNestedWorkspacesAcrossWorkspaces,
  regenerateWorkspaceDashboardTemplate,
  removeNestedWorkspaceFromAllWorkspaces,
  unclaimWorkspace,
  updateWorkspace,
} from "../services/workspace-service";
import { resolveWorkspaceColor } from "../theme-data";
import { theme } from "../stores/theme";
import WorkspaceRowBody from "../components/WorkspaceRowBody.svelte";
import GearIcon from "../icons/GearIcon.svelte";
import GridIcon from "../icons/GridIcon.svelte";
import WorkspacesWidget from "../components/WorkspacesWidget.svelte";
import { registerMarkdownComponent } from "../services/markdown-component-registry";
import type { Workspace } from "../config";
import {
  pendingCreateResolver,
  createDialogPrefill,
} from "../stores/workspaces-ui";
import { invoke } from "@tauri-apps/api/core";
import { getActiveCwd, wsMeta } from "../services/service-helpers";
import type { NestedWorkspaceMetadata } from "../types";
import {
  createNestedWorkspaceFromDef,
  switchNestedWorkspace,
} from "../services/nested-workspace-service";

/**
 * Stage 5 moved Workspaces out of the extension layer and into core,
 * alongside NestedWorkspaces. Registry contributions (commands,
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
  const targetWorkspaceId = metadata?.parentWorkspaceId;
  if (!targetWorkspaceId) return;
  addNestedWorkspaceToWorkspace(targetWorkspaceId, event.id);
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
  const parentWorkspaceId = wsMeta(ws).parentWorkspaceId;
  if (typeof parentWorkspaceId !== "string") return;
  const workspace = getWorkspaces().find((w) => w.id === parentWorkspaceId);
  if (!workspace) return;
  void invoke<boolean>("is_git_repo", { path: workspace.path })
    .then((isGit) => {
      if (isGit !== workspace.isGit) {
        updateWorkspace(parentWorkspaceId, { isGit });
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
 * Drive the full create flow: open the dialog, persist the workspace,
 * and spawn its Dashboard nestedWorkspace. Returns the new workspace
 * id on success, null on cancel.
 */
async function createWorkspaceFlow(prefill?: {
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
  const workspace: Workspace = {
    id,
    name: result.name,
    path: result.path,
    color: result.color,
    nestedWorkspaceIds: [],
    isGit,
    createdAt: new Date().toISOString(),
  };

  addWorkspace(workspace);

  // Auto-provision every autoProvision dashboard contribution for the
  // new workspace (Overview, Settings, and any extension-owned
  // autoProvision contributions like Agentic). The Overview dashboard
  // is tracked via `workspace.dashboardNestedWorkspaceId` so
  // `openWorkspaceDashboard` can activate it directly; the helper
  // returns its id when the contribution's source is core + id is
  // "group" (the stable persisted contribution id).
  try {
    await provisionAutoDashboardsForWorkspace(workspace);
    const overview = get(nestedWorkspaces).find((w) =>
      isDashboardWorkspace(w, workspace.id, OVERVIEW_DASHBOARD_CONTRIBUTION_ID),
    );
    if (overview) {
      updateWorkspace(id, { dashboardNestedWorkspaceId: overview.id });
    }
  } catch (err) {
    console.error(
      `[workspaces] Failed to auto-provision dashboards: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Spawn an initial nestedWorkspace inside the new workspace and
  // activate it. The workspace:created handler claims it into the
  // parent automatically when it sees metadata.parentWorkspaceId.
  try {
    const wsCount =
      getWorkspaces().find((w) => w.id === id)?.nestedWorkspaceIds.length ?? 0;
    await createNestedWorkspaceFromDef({
      name: `${result.name} Workspace ${wsCount + 1}`,
      cwd: result.path,
      metadata: { parentWorkspaceId: id },
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    });
    const newWs = get(nestedWorkspaces)
      .slice()
      .reverse()
      .find(
        (w) => wsMeta(w).parentWorkspaceId === id && !wsMeta(w).isDashboard,
      );
    if (newWs) {
      updateWorkspace(id, { primaryNestedWorkspaceId: newWs.id });
      const idx = get(nestedWorkspaces).indexOf(newWs);
      if (idx >= 0) switchNestedWorkspace(idx);
    }
  } catch (err) {
    console.error(
      `[workspaces] Failed to spawn initial nestedWorkspace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  setActiveWorkspaceId(id);
  return id;
}

/**
 * Promote the active, parent-less nestedWorkspace into a new Workspace
 * rooted at that nestedWorkspace's current working directory. Opens
 * the create dialog with path/name pre-filled, then moves the
 * nestedWorkspace into the created workspace.
 */
async function promoteActiveNestedWorkspaceToWorkspace(): Promise<void> {
  const list = get(nestedWorkspaces);
  const idx = get(activeNestedWorkspaceIdx);
  const activeWs = typeof idx === "number" ? list[idx] : undefined;
  if (!activeWs) return;

  // getActiveCwd observes the shell's OSC 7 signal — more accurate than
  // whatever was persisted.
  const cwd = (await getActiveCwd()) || (activeWs as { cwd?: string }).cwd;
  if (!cwd) {
    console.warn("[workspaces] Cannot promote — unknown working directory");
    return;
  }

  const derivedName = cwd.replace(/\/+$/, "").split("/").pop() || activeWs.name;

  const newWorkspaceId = await createWorkspaceFlow({
    path: cwd,
    name: derivedName,
  });
  if (!newWorkspaceId) return;

  // Move the nestedWorkspace into the new workspace. workspace:created
  // already fired at creation time, so replay the claim bookkeeping
  // manually.
  addNestedWorkspaceToWorkspace(newWorkspaceId, activeWs.id);
  claimWorkspace(activeWs.id, SOURCE);
}

/**
 * Register one palette command per workspace —
 * "<workspace>: New NestedWorkspace". Re-run whenever workspaces
 * change so added workspaces get their commands.
 */
function registerPerWorkspaceCommands(): void {
  for (const workspace of getWorkspaces()) {
    registerCommand({
      id: `new-ws-${workspace.id}`,
      title: `${workspace.name}: New NestedWorkspace`,
      source: SOURCE,
      action: () => {
        const count =
          getWorkspaces().find((w) => w.id === workspace.id)?.nestedWorkspaceIds
            .length ?? 0;
        void createNestedWorkspaceFromDef({
          name: `${workspace.name} Workspace ${count + 1}`,
          cwd: workspace.path,
          metadata: { parentWorkspaceId: workspace.id },
          layout: { pane: { surfaces: [{ type: "terminal" }] } },
        });
      },
    });
  }
}

export async function initWorkspaces(): Promise<void> {
  await loadWorkspaces();

  // Seed rootRowOrder with each existing workspace. appendRootRow is
  // idempotent, so a persisted order is preserved.
  for (const workspace of getWorkspaces()) {
    appendRootRow({ kind: "workspace", id: workspace.id });
  }

  // Re-claim any restored nestedWorkspaces that belong to a known
  // workspace — nestedWorkspace ids change on every restart, so the
  // nestedWorkspaceIds list is rebuilt from metadata.parentWorkspaceId
  // on each load.
  reclaimNestedWorkspacesAcrossWorkspaces();

  registerPerWorkspaceCommands();

  // Root-row renderer for "workspace" kind. ContainerRow inside
  // the renderer owns the grip/banner/nested-list chrome; the rail
  // color + label resolvers let the outer list paint the grip in the
  // workspace's color and show its name in the drag overlay.
  registerRootRowRenderer({
    id: "workspace",
    source: SOURCE,
    component: WorkspaceRowBody,
    railColor: (id: string) => {
      const workspace = getWorkspaces().find((w) => w.id === id);
      if (!workspace) return undefined;
      return resolveWorkspaceColor(workspace.color, get(theme));
    },
    label: (id: string) => getWorkspaces().find((w) => w.id === id)?.name,
  });

  // Formerly owned by the worktree-nestedWorkspaces extension.
  // Registered here so the action is available in context menus on
  // git-backed workspaces. The ⎇ Branch button in
  // WorkspaceSectionContent calls the command directly; this action
  // surfaces it in the workspace action registry.
  registerWorkspaceAction({
    id: "core:create-worktree",
    label: "⎇ Branch",
    icon: "git-branch",
    source: SOURCE,
    when: (ctx) => !!ctx?.parentWorkspaceId && ctx.isGit === true,
    handler: (ctx) => {
      runCommandById("worktrees:create-workspace", ctx);
    },
  });

  // Commands
  registerCommand({
    id: "create-workspace",
    title: "Create Workspace...",
    source: SOURCE,
    action: () => {
      void createWorkspaceFlow();
    },
  });

  registerCommand({
    id: "promote-nested-workspace-to-workspace",
    title: "Promote NestedWorkspace to Workspace...",
    source: SOURCE,
    action: () => {
      void promoteActiveNestedWorkspaceToWorkspace();
    },
  });

  registerCommand({
    id: "open-workspace-dashboard",
    title: "Open Workspace Dashboard...",
    source: SOURCE,
    action: () => {
      const workspaces = getWorkspaces();
      if (workspaces.length === 0) return;
      const activeId = getActiveWorkspaceId();
      const workspace = activeId
        ? workspaces.find((w) => w.id === activeId)
        : workspaces[0];
      if (!workspace) return;
      void openWorkspaceDashboard(workspace);
    },
  });

  // Surfaced in PaneView's TabBar for nestedWorkspaces belonging to a
  // workspace.
  registerCommand({
    id: "workspaces:regenerate-active-workspace-dashboard",
    title: "Spawn Workspace Dashboard",
    source: SOURCE,
    action: () => {
      const list = get(nestedWorkspaces);
      const idx = get(activeNestedWorkspaceIdx);
      const ws = typeof idx === "number" ? list[idx] : undefined;
      const parentWorkspaceId = ws ? wsMeta(ws).parentWorkspaceId : undefined;
      if (typeof parentWorkspaceId !== "string") return;
      const workspace = getWorkspaces().find((w) => w.id === parentWorkspaceId);
      if (workspace) void openWorkspaceDashboard(workspace);
    },
  });

  // Core-internal "Workspace Dashboard" contribution — id `group`
  // (stable persisted contribution id, retained across the rename),
  // capPerWorkspace 1, autoProvision. Materializes the per-workspace
  // Overview nestedWorkspace. `lockedReason` surfaces in the Settings
  // dashboard's toggle list explaining why the toggle is fixed-on.
  registerDashboardContribution({
    id: OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
    source: "core",
    label: "Workspace Dashboard",
    actionLabel: "Add Workspace Dashboard",
    capPerWorkspace: 1,
    autoProvision: true,
    icon: GridIcon,
    lockedReason: "Required (Overview)",
    create: async (workspace: Workspace) =>
      await createWorkspaceDashboardNestedWorkspace(workspace),
    regenerate: async (workspace: Workspace) =>
      await regenerateWorkspaceDashboardTemplate(workspace),
  });

  // Core-internal "Settings" contribution — id `settings`,
  // autoProvision. Hosts the per-workspace dashboard toggles + name /
  // color picker. PaneView renders WorkspaceDashboardSettings in place
  // of the surface list for nestedWorkspaces carrying this
  // contribution id.
  registerDashboardContribution({
    id: "settings",
    source: "core",
    label: "Settings",
    actionLabel: "Add Settings Dashboard",
    capPerWorkspace: 1,
    autoProvision: true,
    icon: GearIcon,
    lockedReason: "Required (Settings)",
    create: async (workspace: Workspace) =>
      await createSettingsDashboardWorkspace(workspace),
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
