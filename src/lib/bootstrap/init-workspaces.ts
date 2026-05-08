/**
 * Workspaces bootstrap — registers the commands, workspace action,
 * root-row renderer, overlay, and Dashboard contribution that let
 * users create and manage Workspaces.
 *
 * Called after the core event bus and workspaces store are live, and
 * after included extensions register (so registration order matches
 * the previous extension-activation behavior).
 */
import { get } from "svelte/store";
import { registerCommand } from "../services/command-registry";
import { registerRootRowRenderer } from "../services/root-row-renderer-registry";
import { registerSurfaceType } from "../services/surface-type-registry";
import { openWorkspaceSettingsTab } from "../services/surface-service";
import WorkspaceDashboardSettings from "../components/WorkspaceDashboardSettings.svelte";
import { registerDashboardContribution } from "../services/dashboard-contribution-registry";
import { eventBus, type AppEvent } from "../services/event-bus";
import { appendRootRow } from "../stores/root-row-order";
import { workspaces } from "../stores/workspace";
import {
  loadWorkspaces,
  getWorkspaces,
  setActiveWorkspaceId,
} from "../stores/workspace";
import {
  addBranchToWorkspace,
  provisionAutoDashboardsForWorkspace,
  reclaimBranchedWorkspaces,
  removeBranchFromAllWorkspaces,
  updateWorkspace,
} from "../services/workspace-service";
import { resolveWorkspaceColor } from "../theme-data";
import { theme } from "../stores/theme";
import WorkspaceRowBody from "../components/WorkspaceRowBody.svelte";
import GearIcon from "../icons/GearIcon.svelte";
import type { RootWorkspace as Workspace } from "../stores/workspace";
import {
  pendingCreateResolver,
  createDialogPrefill,
} from "../stores/workspaces-ui";
import { invoke } from "@tauri-apps/api/core";
import { createWorkspaceFromDef } from "../services/workspace-runtime-service";
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
 * Registry contributions (commands, workspace actions, root-row
 * renderers, dashboard contributions) stamp their origin under the
 * shared `"core"` source so extensions that unregister themselves by
 * source can't sweep core contributions, and so `ExtensionWrapper` can
 * look up a single shared `"core"` API when mounting core-owned
 * components.
 */
const SOURCE = "core";

function generateId(): string {
  return crypto.randomUUID();
}

function onWorkspaceCreated(event: AppEvent): void {
  if (event.type !== "workspace:created") return;
  const ws = get(workspaces).find((w) => w.id === event.id);
  const rootWorkspaceId = ws?.rootWorkspaceId;
  if (typeof rootWorkspaceId !== "string") return;
  addBranchToWorkspace(rootWorkspaceId, event.id);
}

function onWorkspaceClosed(event: AppEvent): void {
  if (event.type !== "workspace:closed") return;
  removeBranchFromAllWorkspaces(event.id);
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
export async function createWorkspaceFlow(prefill?: {
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
  const baseDef: WorkspaceTemplate = {
    id,
    name: result.name,
    path: result.path,
    color: result.color,
    cwd: result.path,
    isGit,
    createdAt: new Date().toISOString(),
    layout: { pane: { surfaces: [{ type: "terminal" }] } },
  };
  const resolvedDef = await applyRepoDef(baseDef, result.path);

  try {
    await createWorkspaceFromDef(resolvedDef);
  } catch (err) {
    console.error(
      `[workspaces] Failed to create workspace: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  const workspace = getWorkspaces().find((w) => w.id === id);
  if (!workspace) {
    console.error("[workspaces] Workspace not found in store after creation");
    return null;
  }

  // Auto-provision every autoProvision dashboard contribution for the
  // new workspace (currently only Settings). Dashboards are tabs in
  // the workspace's pane; openAsTab handles dedupe internally.
  try {
    await provisionAutoDashboardsForWorkspace(workspace);
  } catch (err) {
    console.error(
      `[workspaces] Failed to auto-provision dashboards: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  setActiveWorkspaceId(id);
  return id;
}

export async function initWorkspaces(): Promise<void> {
  await loadWorkspaces();

  // Seed rootRowOrder with each existing workspace. appendRootRow is
  // idempotent, so a persisted order is preserved.
  for (const workspace of getWorkspaces()) {
    appendRootRow({ kind: "workspace", id: workspace.id });
  }

  // Rebuild branchedWorkspaceIds from rootWorkspaceId — Branch ids
  // change on every restart, so the membership list is recomputed
  // from the canonical tag on each load.
  reclaimBranchedWorkspaces();

  // Root-row renderer for "workspace" kind. SidebarBanner inside
  // the renderer owns the grip/bar/child-list chrome; the rail
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
    openAsTab: async (workspace: Workspace, opts) => {
      await openWorkspaceSettingsTab(workspace.id, opts);
    },
  });

  // Core-internal surface type for the per-workspace Settings panel.
  // Spawned as a tab inside the workspace's primary pane via the
  // banner gear chip, so users can edit settings without leaving the
  // workspace. Hidden from the "+ new surface" menu — it's reached
  // through the gear, not from an empty pane.
  registerSurfaceType({
    id: "core:workspace-settings",
    label: "Workspace Settings",
    component: WorkspaceDashboardSettings,
    source: "core",
    hideFromNewSurface: true,
  });

  eventBus.on("workspace:created", onWorkspaceCreated);
  eventBus.on("workspace:closed", onWorkspaceClosed);
  eventBus.on("workspace:activated", onWorkspaceActivated);
}
