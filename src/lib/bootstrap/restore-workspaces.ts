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
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getWorkspaceGroups } from "../stores/workspace-groups";
import { loadState, type GnarTermConfig, type WorkspaceDef } from "../config";
import {
  createWorkspace,
  createWorkspaceFromDef,
  switchWorkspace,
} from "../services/workspace-service";

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
    const def: WorkspaceDef = {
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
  if (Array.isArray(state.workspaces)) {
    // Clear any existing workspaces to prevent doubling on re-mount
    workspaces.set([]);
    // Drop orphan Dashboard workspaces whose owning group no longer
    // exists. Without this, restarting after a group deletion leaves a
    // ghost dashboard in the main view that the user can't navigate
    // away from via the sidebar.
    const knownGroupIds = new Set(getWorkspaceGroups().map((g) => g.id));
    const filteredDefs = state.workspaces.filter((wsDef) => {
      const md = wsDef.metadata as Record<string, unknown> | undefined;
      const isDashboard = md?.isDashboard === true;
      const ownerGroupId = md?.groupId;
      if (!isDashboard) return true;
      if (typeof ownerGroupId !== "string") return true;
      return knownGroupIds.has(ownerGroupId);
    });
    for (const wsDef of filteredDefs) {
      await createWorkspaceFromDef(wsDef, { restoring: true });
    }
    // Restored workspaces whose `metadata.isDashboard === true` are
    // group/pseudo dashboards — accessed through their group's tile,
    // not as a primary active surface. If the only restored workspaces
    // are dashboards, leave `activeWorkspaceIdx = -1` so the main view
    // renders the EmptySurface. Otherwise pick the persisted active
    // index unless it points at a dashboard, in which case fall through
    // to the first non-dashboard workspace.
    const restored = get(workspaces);
    if (restored.length > 0) {
      const isDashboard = (idx: number): boolean => {
        const md = restored[idx]?.metadata as
          | Record<string, unknown>
          | undefined;
        return md?.isDashboard === true;
      };
      const persistedIdx = state.activeWorkspaceIdx ?? 0;
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
  if (!autoloaded && get(workspaces).length === 0) {
    await createWorkspace("Workspace 1");
  }
}
