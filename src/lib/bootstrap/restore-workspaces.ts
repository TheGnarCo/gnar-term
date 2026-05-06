/**
 * Initial workspace population on launch.
 *
 * Resolution order (first match wins):
 *   1. --workspace <name> — open a named workspace from config.commands
 *   2. --path / --working-directory / --command — synthesize a one-off
 *      workspace around the CLI args
 *   3. persisted state.json — restore the last session's workspaces
 *   4. config.autoload — open every named workspace listed
 *   5. fall back to a single default "Workspace 1"
 *
 * If `state.workspaces[]` is present (unified format), `seedWorkspaces()`
 * is called to hydrate the new store.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getWorkspaces } from "../stores/workspace";
import {
  loadState,
  type GnarTermConfig,
  type WorkspaceTemplate,
  type WorkspaceDef,
} from "../config";
import { seedWorkspaces, workspaceDefToTemplate } from "../stores/workspace";
import { initArchiveFromState } from "../stores/archive";
import { uid } from "../types";
import type { Workspace, BranchedWorkspace } from "../types";
import {
  createWorkspace,
  createWorkspaceFromDef,
  switchWorkspace,
} from "../services/workspace-runtime-service";
import { OVERVIEW_DASHBOARD_CONTRIBUTION_ID } from "../services/dashboard-contribution-registry";

// Restore-complete signal — lets async work (extension provision loops,
// reconcileWorkspaceDashboards) defer safely until workspaces are in the store.
let _restored = false;
const _waiters: Array<() => void> = [];

export function markRestored(): void {
  _restored = true;
  for (const r of _waiters) r();
  _waiters.length = 0;
}

/** Resolves immediately if workspaces are already restored; waits otherwise. */
export function waitRestored(): Promise<void> {
  if (_restored) return Promise.resolve();
  return new Promise((r) => _waiters.push(r));
}

/** Reset for tests — allows signal to fire again in a fresh test context. */
export function resetRestoreSignal(): void {
  _restored = false;
  _waiters.length = 0;
}

/**
 * Deserialize a WorkspaceDef into a runtime Workspace object.
 * This reconstructs a minimal Workspace suitable for `seedWorkspaces()`.
 * The paneLayout is built lazily — it carries a single pane with no
 * surfaces until the full restore path populates it.
 */
export function workspaceDefToWorkspace(def: WorkspaceDef): Workspace {
  const paneId = uid();
  const ws: Workspace = {
    id: def.id,
    name: def.name,
    paneLayout: {
      type: "pane",
      pane: { id: paneId, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: paneId,
  };
  if (def.path !== undefined) ws.path = def.path;
  if (def.color !== undefined) ws.color = def.color;
  if (def.isGit !== undefined) ws.isGit = def.isGit;
  if (def.createdAt !== undefined) ws.createdAt = def.createdAt;
  if (def.autoRunRestoreCommands !== undefined)
    ws.autoRunRestoreCommands = def.autoRunRestoreCommands;
  if (def.lastActiveBranchedWorkspaceId !== undefined)
    ws.lastActiveBranchedWorkspaceId = def.lastActiveBranchedWorkspaceId;
  if (def.dashboardWorkspaceId !== undefined)
    ws.dashboardWorkspaceId = def.dashboardWorkspaceId;
  if (def.locked !== undefined) ws.locked = def.locked;
  // Migration compat: old state.json files persist `rootWorkspaceId`; accept
  // both names so existing installs load correctly. Write only the new name.
  const rootWorkspaceId =
    def.rootWorkspaceId ??
    (def as unknown as { rootWorkspaceId?: string }).rootWorkspaceId;
  if (rootWorkspaceId !== undefined) ws.rootWorkspaceId = rootWorkspaceId;
  if (def.isDashboard !== undefined) ws.isDashboard = def.isDashboard;
  if (def.dashboardContributionId !== undefined)
    ws.dashboardContributionId = def.dashboardContributionId;
  if (def.extensionData !== undefined) ws.extensionData = def.extensionData;
  // BranchedWorkspace fields — cast to mutable BranchedWorkspace to set extra fields
  if (def.worktreePath !== undefined) {
    const bws = ws as BranchedWorkspace;
    bws.worktreePath = def.worktreePath;
    if (def.branch !== undefined) bws.branch = def.branch;
    if (def.baseBranch !== undefined) bws.baseBranch = def.baseBranch;
    if (def.repoPath !== undefined) bws.repoPath = def.repoPath;
  }
  return ws;
}

export interface CliArgs {
  path: string | null;
  working_directory: string | null;
  command: string | null;
  title: string | null;
  workspace: string | null;
  config: string | null;
}

export async function restoreWorkspaces(
  cliArgs: CliArgs,
  config: GnarTermConfig,
): Promise<void> {
  const cliCwd = cliArgs.path || cliArgs.working_directory;

  if (cliArgs.workspace) {
    const cmd = config.commands?.find(
      (c) => c.name === cliArgs.workspace && c.workspace,
    );
    if (cmd?.workspace) {
      await createWorkspaceFromDef(cmd.workspace);
    } else {
      console.warn(
        `[cli] Workspace "${cliArgs.workspace}" not found in config`,
      );
      await createWorkspace(cliArgs.title || "Workspace 1");
    }
    return;
  }

  if (cliCwd || cliArgs.command) {
    const wsName = cliArgs.title || cliCwd?.split("/").pop() || "Workspace 1";
    const def: WorkspaceTemplate = {
      name: wsName,
      cwd: cliCwd || undefined,
      layout: {
        pane: {
          surfaces: [
            {
              type: "terminal",
              cwd: cliCwd || undefined,
              command: cliArgs.command || undefined,
            },
          ],
        },
      },
    };
    await createWorkspaceFromDef(def);
    return;
  }

  // Try to restore persisted workspaces from state.json
  const state = await loadState();
  initArchiveFromState();

  // ---------------------------------------------------------------------------
  // Unified format: state.workspaces[] is the canonical on-disk shape.
  // Convert each WorkspaceDef back to a legacy WorkspaceTemplate and feed
  // through `createWorkspaceFromDef` so PTY surfaces hydrate via the
  // existing path.
  // ---------------------------------------------------------------------------
  if (Array.isArray(state.workspaces) && state.workspaces.length > 0) {
    // Stage 10: WorkspaceRecord defs are also hydrated as runtime
    // workspaces — the Workspace's tab surface lives at the same id as
    // its Record. Branches and Dashboards continue to ride alongside.
    // The Record store still loads from the same defs (in
    // `loadWorkspaces()`) for sidebar metadata.
    const runtimeDefs = state.workspaces as WorkspaceDef[];
    const wsList = runtimeDefs.map(workspaceDefToWorkspace);
    seedWorkspaces(wsList, state.activeWorkspaceId ?? null);

    workspaces.set([]);
    const knownWorkspaceIds = new Set(getWorkspaces().map((g) => g.id));
    const seenDashboards = new Set<string>();
    const filteredDefs = runtimeDefs.filter((def) => {
      const isDashboard = def.isDashboard === true;
      const ownerWorkspaceId =
        def.rootWorkspaceId ??
        (def as unknown as { rootWorkspaceId?: string }).rootWorkspaceId;
      if (!isDashboard) return true;
      if (typeof ownerWorkspaceId !== "string") return true;
      if (!knownWorkspaceIds.has(ownerWorkspaceId)) return false;
      const contributionId =
        typeof def.dashboardContributionId === "string"
          ? def.dashboardContributionId
          : OVERVIEW_DASHBOARD_CONTRIBUTION_ID;
      const dedupeKey = `${ownerWorkspaceId}:${contributionId}`;
      if (seenDashboards.has(dedupeKey)) return false;
      seenDashboards.add(dedupeKey);
      return true;
    });
    for (const def of filteredDefs) {
      const nwDef = workspaceDefToTemplate(def);
      await createWorkspaceFromDef(nwDef, { restoring: true });
    }
    const restored = get(workspaces);
    if (restored.length > 0) {
      const isDashboard = (idx: number): boolean => {
        const ws = restored[idx];
        return ws ? ws.isDashboard === true : false;
      };
      const activeId = state.activeWorkspaceId;
      let targetIdx = -1;
      if (typeof activeId === "string") {
        const idx = restored.findIndex((w) => w.id === activeId);
        if (idx >= 0 && !isDashboard(idx)) targetIdx = idx;
      }
      if (targetIdx < 0) {
        targetIdx = restored.findIndex((_, i) => !isDashboard(i));
      }
      if (targetIdx >= 0) {
        switchWorkspace(targetIdx);
      }
    }
    return;
  }

  // First launch — autoload from config, else seed a workspace.
  let autoloaded = false;
  if (config.autoload && config.autoload.length > 0 && config.commands) {
    for (const name of config.autoload) {
      const cmd = config.commands.find((c) => c.name === name && c.workspace);
      if (cmd?.workspace) {
        await createWorkspaceFromDef(cmd.workspace);
        autoloaded = true;
      }
    }
  }
  if (!autoloaded && get(workspaces).length === 0) {
    await createWorkspace("Workspace 1");
  }
}
