/**
 * Workspaces bootstrap — core's counterpart to the deleted
 * project-scope extension (Stage 5). Registers the commands, workspace
 * action, root-row renderer, overlay, and Dashboard contribution that
 * let users create and manage Workspaces.
 *
 * Called after the core event bus, claimed-workspace registry, and
 * workspaces store are live, and after included extensions register
 * (so registration order matches the previous extension-activation
 * behavior).
 */
import { get } from "svelte/store";
import { registerCommand } from "../services/command-registry";
import { registerRootRowRenderer } from "../services/root-row-renderer-registry";
import {
  registerDashboardContribution,
  OVERVIEW_DASHBOARD_CONTRIBUTION_ID,
} from "../services/dashboard-contribution-registry";
import { eventBus, type AppEvent } from "../services/event-bus";
import { appendRootRow } from "../stores/root-row-order";
import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
import {
  loadWorkspaces,
  getWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "../stores/workspace";
import {
  addWorkspace,
  addChildToWorkspace,
  claimWorkspace,
  createWorkspaceDashboard,
  createSettingsDashboardWorkspace,
  isDashboardWorkspace,
  openWorkspaceDashboard,
  provisionAutoDashboardsForWorkspace,
  reclaimChildWorkspaces,
  regenerateWorkspaceDashboardTemplate,
  removeChildFromAllWorkspaces,
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
import type { WorkspaceRecord as Workspace } from "../stores/workspace";
import {
  pendingCreateResolver,
  createDialogPrefill,
} from "../stores/workspaces-ui";
import { invoke } from "@tauri-apps/api/core";
import { getActiveCwd } from "../services/service-helpers";
import type { WorkspaceMetadata } from "../types";
import {
  createWorkspaceFromDef,
  switchWorkspace,
} from "../services/workspace-runtime-service";
import type { WorkspaceTemplate } from "../config";

/**
 * Check if `repoPath` contains a `.gnar-term/workspace.json` bootstrap file.
 * If it does, parse it and merge its fields into `defaultDef` (repo config
 * overrides defaults; unspecified fields are preserved from `defaultDef`).
 * Falls back silently to `defaultDef` on missing file or invalid JSON.
 */
export async function applyRepoDef(
  defaultDef: WorkspaceTemplate,
  repoPath: string,
): Promise<WorkspaceTemplate> {
  const bootstrapPath = `${repoPath}/.gnar-term/workspace.json`;
  const hasBootstrap = await invoke<boolean>("file_exists", {
    path: bootstrapPath,
  });
  if (!hasBootstrap) return defaultDef;
  try {
    const raw = await invoke<string>("read_file", { path: bootstrapPath });
    return { ...defaultDef, ...JSON.parse(raw) };
  } catch {
    console.warn(
      "[bootstrap] Invalid .gnar-term/workspace.json, using defaults",
    );
    return defaultDef;
  }
}

/**
 * Stage 5 moved Workspaces out of the extension layer and into core.
 * Registry contributions (commands,
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
  // rootWorkspaceId is a top-level Workspace field; read it directly from
  // the live runtime workspace, falling back to the event payload for
  // backwards compatibility with emitters that still pass metadata only.
  const ws = get(workspaces).find((w) => w.id === event.id);
  const rootWorkspaceId =
    ws?.rootWorkspaceId ??
    (event.metadata as WorkspaceMetadata | undefined)?.rootWorkspaceId ??
    (event.metadata as WorkspaceMetadata | undefined)?.rootWorkspaceId;
  if (typeof rootWorkspaceId !== "string") return;
  addChildToWorkspace(rootWorkspaceId, event.id);
  claimWorkspace(event.id, SOURCE);
}

function onWorkspaceClosed(event: AppEvent): void {
  if (event.type !== "workspace:closed") return;
  removeChildFromAllWorkspaces(event.id);
  unclaimWorkspace(event.id);
}

function onWorkspaceActivated(event: AppEvent): void {
  if (event.type !== "workspace:activated") return;
  const ws = get(workspaces).find((w) => w.id === event.id);
  if (!ws) return;
  const rootWorkspaceId = ws.rootWorkspaceId;
  if (typeof rootWorkspaceId !== "string") return;
  const workspace = getWorkspaces().find((w) => w.id === rootWorkspaceId);
  if (!workspace) return;
  void invoke<boolean>("is_git_repo", { path: workspace.path })
    .then((isGit) => {
      if (isGit !== workspace.isGit) {
        updateWorkspace(rootWorkspaceId, { isGit });
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
 * and spawn its Dashboard child workspace. Returns the new workspace
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
  // Caller passes a record-shaped workspace; addWorkspace mints a
  // placeholder splitRoot / activePaneId so the entry satisfies the
  // unified Workspace shape until the matching runtime tab surface is
  // built by createWorkspaceFromDef below.
  const workspace: Workspace = {
    id,
    name: result.name,
    path: result.path,
    color: result.color,
    branchedWorkspaceIds: [],
    isGit,
    createdAt: new Date().toISOString(),
  };

  addWorkspace(workspace);

  // Auto-provision every autoProvision dashboard contribution for the
  // new workspace (Overview, Settings, and any extension-owned
  // autoProvision contributions like Agentic). The Overview dashboard
  // is tracked via `workspace.dashboardWorkspaceId` so
  // `openWorkspaceDashboard` can activate it directly; the helper
  // returns its id when the contribution's source is core + id is
  // "group" (the stable persisted contribution id).
  try {
    await provisionAutoDashboardsForWorkspace(workspace);
    const overview = get(workspaces).find((w) =>
      isDashboardWorkspace(w, workspace.id, OVERVIEW_DASHBOARD_CONTRIBUTION_ID),
    );
    if (overview) {
      updateWorkspace(id, { dashboardWorkspaceId: overview.id });
    }
  } catch (err) {
    console.error(
      `[workspaces] Failed to auto-provision dashboards: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ADR-004 Stage 10: materialize the Root runtime Workspace whose id
  // matches the WorkspaceRecord, so the sidebar row's tab surface
  // exists immediately. No `rootWorkspaceId` — the Root IS the
  // Workspace, not a Branch of itself.
  try {
    const initialDef: WorkspaceTemplate = {
      id,
      name: result.name,
      cwd: result.path,
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    };
    const resolvedDef = await applyRepoDef(initialDef, result.path);
    await createWorkspaceFromDef(resolvedDef);
    const idx = get(workspaces).findIndex((w) => w.id === id);
    if (idx >= 0) switchWorkspace(idx);
  } catch (err) {
    console.error(
      `[workspaces] Failed to spawn Root runtime workspace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  setActiveWorkspaceId(id);
  return id;
}

/**
 * Promote the active, unrooted Branch into a new Workspace
 * rooted at that Branch's current working directory. Opens
 * the create dialog with path/name pre-filled, then moves the
 * Branch into the created Workspace.
 */
async function promoteActiveBranch(): Promise<void> {
  const list = get(workspaces);
  const idx = get(activeWorkspaceIdx);
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

  // Move the child workspace into the new workspace. workspace:created
  // already fired at creation time, so replay the claim bookkeeping
  // manually.
  addChildToWorkspace(newWorkspaceId, activeWs.id);
  claimWorkspace(activeWs.id, SOURCE);
}

export async function initWorkspaces(): Promise<void> {
  await loadWorkspaces();

  // Seed rootRowOrder with each existing workspace. appendRootRow is
  // idempotent, so a persisted order is preserved.
  for (const workspace of getWorkspaces()) {
    appendRootRow({ kind: "workspace", id: workspace.id });
  }

  // Re-claim any restored Branches that belong to a known Workspace —
  // Branch ids change on every restart, so the branchedWorkspaceIds list
  // is rebuilt from rootWorkspaceId on each load.
  reclaimChildWorkspaces();

  // Root-row renderer for "workspace" kind. ContainerRow inside
  // the renderer owns the grip/banner/child-list chrome; the rail
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
    id: "promote-child-workspace",
    title: "Promote to Workspace...",
    source: SOURCE,
    action: () => {
      void promoteActiveBranch();
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

  // Surfaced in PaneView's TabBar for workspaces belonging to a
  // workspace.
  registerCommand({
    id: "workspaces:regenerate-active-workspace-dashboard",
    title: "Spawn Workspace Dashboard",
    source: SOURCE,
    action: () => {
      const list = get(workspaces);
      const idx = get(activeWorkspaceIdx);
      const ws = typeof idx === "number" ? list[idx] : undefined;
      const rootWorkspaceId = ws?.rootWorkspaceId;
      if (typeof rootWorkspaceId !== "string") return;
      const workspace = getWorkspaces().find((w) => w.id === rootWorkspaceId);
      if (workspace) void openWorkspaceDashboard(workspace);
    },
  });

  // Core-internal "Workspace Dashboard" contribution — id `group`
  // (stable persisted contribution id, retained across the rename),
  // capPerWorkspace 1, autoProvision. Materializes the per-workspace
  // Overview child workspace. `lockedReason` surfaces in the Settings
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
      await createWorkspaceDashboard(workspace),
    regenerate: async (workspace: Workspace) =>
      await regenerateWorkspaceDashboardTemplate(workspace),
  });

  // Core-internal "Settings" contribution — id `settings`,
  // autoProvision. Hosts the per-workspace dashboard toggles + name /
  // color picker. PaneView renders WorkspaceDashboardSettings in place
  // of the surface list for workspaces carrying this
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
