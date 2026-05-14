/**
 * Initial workspace population on launch.
 *
 * Resolution order (first match wins):
 *   1. --workspace <name> — open a named workspace from config.commands
 *   2. --path / --working-directory / --command — synthesize a one-off
 *      workspace around the CLI args
 *   3. persisted state.json — restore the last session's workspaces
 *   4. config.autoload — open every named workspace listed
 *   5. auto-default — if state.workspaces === undefined (no state.json on
 *      disk, or state.json with no workspaces field) AND no workspaces ended
 *      up created from autoload → inject a single "Terminal" workspace at $HOME
 *   6. fall through — store stays empty → App.svelte renders <EmptySurface />
 *      (only reached when state.json exists with an explicit workspaces: [])
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
import { getHome } from "../services/service-helpers";

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
  // state.workspaces[] is the canonical on-disk shape. Convert each
  // WorkspaceDef into the WorkspaceTemplate that `createWorkspaceFromDef`
  // consumes so PTY surfaces hydrate through the standard path.
  // ---------------------------------------------------------------------------
  if (Array.isArray(state.workspaces) && state.workspaces.length > 0) {
    const runtimeDefs = state.workspaces as WorkspaceDef[];

    // Dashboards are tabs now, not workspaces. Silently drop any
    // persisted `isDashboard: true` entry — auto-provisioning runs
    // during `createWorkspaceFromDef` on the surviving root workspaces
    // and re-establishes each contribution as a tab inline. This also
    // implicitly cleans up orphaned dashboards (whose owner workspace
    // is no longer in the persisted set).
    const filteredDefs = runtimeDefs.filter((def) => def.isDashboard !== true);
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

  // Step 4: autoload from config.
  if (config.autoload && config.autoload.length > 0 && config.commands) {
    for (const name of config.autoload) {
      const cmd = config.commands.find((c) => c.name === name && c.workspace);
      if (cmd?.workspace) {
        await createWorkspaceFromDef(cmd.workspace);
      }
    }
  }

  // Step 5: auto-default Terminal workspace.
  //
  // Gate: state.workspaces was undefined (no state.json on disk, or state.json
  // exists but has no workspaces field) AND no workspaces ended up in the store
  // from the steps above.
  //
  // Distinguish from state.workspaces === [] (explicit empty array) which means
  // the user deleted all workspaces on purpose — that falls through to EmptySurface.
  if (state.workspaces === undefined && get(workspaces).length === 0) {
    const home = await getHome();
    const def: WorkspaceTemplate = {
      name: "Terminal",
      cwd: home,
      layout: {
        pane: {
          surfaces: [{ type: "terminal", cwd: home }],
        },
      },
    };
    await createWorkspaceFromDef(def);
  }
}
