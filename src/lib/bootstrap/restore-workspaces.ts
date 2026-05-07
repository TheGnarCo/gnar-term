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
 * If `state.workspaces[]` is present (unified format), each entry is
 * fed directly through `createWorkspaceFromDef` with `restoring: true`.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import {
  loadState,
  type GnarTermConfig,
  type WorkspaceTemplate,
  type WorkspaceDef,
} from "../config";
import { workspaceDefToTemplate } from "../stores/workspace";
import { initArchiveFromState } from "../stores/archive";
import { createWorkspaceFromDef } from "../services/workspace-runtime-service";
import { switchWorkspace } from "../services/workspace-runtime-service";
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
      // Unknown --workspace name: warn and leave the store empty so the
      // launcher (EmptySurface) is shown. We won't synthesize a naked
      // workspace as a fallback — the user can create one from the dialog.
      console.warn(
        `[cli] Workspace "${cliArgs.workspace}" not found in config`,
      );
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
    const runtimeDefs = state.workspaces as WorkspaceDef[];

    // Persisted dashboards are dropped if their owning Workspace isn't
    // about to be re-created. Drive the check off `runtimeDefs` (the
    // source of truth for re-creation) rather than the live store,
    // which is empty until `createWorkspaceFromDef` runs below.
    const knownWorkspaceIds = new Set(
      runtimeDefs
        .filter(
          (def) =>
            def.isDashboard !== true &&
            typeof def.rootWorkspaceId !== "string" &&
            typeof def.worktreePath !== "string",
        )
        .map((def) => def.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const seenDashboards = new Set<string>();
    const filteredDefs = runtimeDefs.filter((def) => {
      const isDashboard = def.isDashboard === true;
      const ownerWorkspaceId = def.rootWorkspaceId;
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

  // First launch — autoload from config, otherwise leave the store empty
  // so App.svelte renders <EmptySurface />.
  if (config.autoload && config.autoload.length > 0 && config.commands) {
    for (const name of config.autoload) {
      const cmd = config.commands.find((c) => c.name === name && c.workspace);
      if (cmd?.workspace) {
        await createWorkspaceFromDef(cmd.workspace);
      }
    }
  }
}
