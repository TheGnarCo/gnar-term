/**
 * Initial workspace population on launch.
 *
 * Resolution order (first match wins):
 *   1. --workspace <name> — open a named workspace from config.commands
 *   2. --path / --working-directory / --command — synthesize a one-off
 *      workspace around the CLI args
 *   3. persisted state.json — restore the last session's nestedWorkspaces
 *   4. config.autoload — open every named workspace listed
 *   5. fall back to a single default "NestedWorkspace 1"
 */
import { get } from "svelte/store";
import { nestedWorkspaces } from "../stores/workspace";
import { getWorkspaceGroups } from "../stores/workspace-groups";
import {
  loadState,
  type GnarTermConfig,
  type NestedWorkspaceDef,
} from "../config";
import { initArchiveFromState } from "../stores/archive";
import {
  createWorkspace,
  createWorkspaceFromDef,
  switchWorkspace,
} from "../services/workspace-service";

// Restore-complete signal — lets async work (extension provision loops,
// reconcileGroupDashboards) defer safely until nestedWorkspaces are in the store.
let _restored = false;
const _waiters: Array<() => void> = [];

export function markRestored(): void {
  _restored = true;
  for (const r of _waiters) r();
  _waiters.length = 0;
}

/** Resolves immediately if nestedWorkspaces are already restored; waits otherwise. */
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
      console.warn(
        `[cli] NestedWorkspace "${cliArgs.workspace}" not found in config`,
      );
      await createWorkspace(cliArgs.title || "NestedWorkspace 1");
    }
    return;
  }

  if (cliCwd || cliArgs.command) {
    const wsName =
      cliArgs.title || cliCwd?.split("/").pop() || "NestedWorkspace 1";
    const def: NestedWorkspaceDef = {
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

  // Try to restore persisted nestedWorkspaces from state.json
  const state = await loadState();
  initArchiveFromState();
  if (Array.isArray(state.nestedWorkspaces)) {
    // Clear any existing nestedWorkspaces to prevent doubling on re-mount
    nestedWorkspaces.set([]);
    // Drop orphan Dashboard nestedWorkspaces whose owning group no longer
    // exists. Without this, restarting after a group deletion leaves a
    // ghost dashboard in the main view that the user can't navigate
    // away from via the sidebar.
    //
    // Additionally dedupe dashboards: each `(groupId, dashboardContributionId)`
    // pair should materialize exactly one dashboard workspace.
    // Pre-fix releases spawned a new Dashboard on every launch because
    // workspace ids regenerated, so persisted state can carry
    // duplicates — keep the first occurrence and drop the rest.
    const knownGroupIds = new Set(getWorkspaceGroups().map((g) => g.id));
    const seenDashboards = new Set<string>();
    const filteredDefs = state.nestedWorkspaces.filter((wsDef) => {
      const md = wsDef.metadata;
      const isDashboard = md?.isDashboard === true;
      const ownerGroupId = md?.groupId;
      if (!isDashboard) return true;
      if (typeof ownerGroupId !== "string") return true;
      if (!knownGroupIds.has(ownerGroupId)) return false;
      const contributionId =
        typeof md?.dashboardContributionId === "string"
          ? md.dashboardContributionId
          : "group";
      const dedupeKey = `${ownerGroupId}:${contributionId}`;
      if (seenDashboards.has(dedupeKey)) return false;
      seenDashboards.add(dedupeKey);
      return true;
    });
    for (const wsDef of filteredDefs) {
      await createWorkspaceFromDef(wsDef, { restoring: true });
    }
    // Restored nestedWorkspaces whose `metadata.isDashboard === true` are
    // group/pseudo dashboards — accessed through their group's tile,
    // not as a primary active surface. If the only restored nestedWorkspaces
    // are dashboards, leave `activeNestedWorkspaceIdx = -1` so the main view
    // renders the EmptySurface. Otherwise pick the persisted active
    // index unless it points at a dashboard, in which case fall through
    // to the first non-dashboard workspace.
    const restored = get(nestedWorkspaces);
    if (restored.length > 0) {
      const isDashboard = (idx: number): boolean => {
        return restored[idx]?.metadata?.isDashboard === true;
      };
      const persistedIdx = state.activeNestedWorkspaceIdx ?? 0;
      const clampedIdx = Math.min(persistedIdx, restored.length - 1);
      let targetIdx = -1;
      if (clampedIdx >= 0 && !isDashboard(clampedIdx)) {
        targetIdx = clampedIdx;
      } else {
        targetIdx = restored.findIndex((_, i) => !isDashboard(i));
      }
      if (targetIdx >= 0) {
        switchWorkspace(targetIdx);
      }
    }
    // An explicit empty array (user closed everything) is a valid
    // restored state — the Empty Surface will render.
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
  if (!autoloaded && get(nestedWorkspaces).length === 0) {
    await createWorkspace("NestedWorkspace 1");
  }
}
