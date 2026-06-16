/**
 * Initial workspace population on launch.
 *
 * Resolution order (first match wins):
 *   1. --workspace <name> — open a named workspace from config.commands
 *   2. --path / --working-directory / --command — synthesize a one-off
 *      workspace around the CLI args
 *   3. persisted state.json — restore the last session's workspaces
 *   4. config.autoload — open every named workspace listed
 *   5. auto-default — if state.workspaces is absent AND nothing was created
 *      above → inject a single "Workspace 1"
 *   6. fall through — store stays empty (only when state.json holds an
 *      explicit empty `workspaces: []`)
 *
 * When `state.workspaces[]` is present each entry is fed through
 * `workspaceDefToTemplate` → `createWorkspaceFromDef({ restoring: true })`
 * so PTY surfaces hydrate through the standard path and grouping tags survive.
 * Dashboards / archive / ssh are out of scope and never restored.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import {
  loadState,
  workspaceDefToTemplate,
  type GnarTermConfig,
  type WorkspaceDef,
} from "../config";
import { createWorkspace, createWorkspaceFromDef, switchWorkspace } from "./workspace-service";

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

  // 1. --workspace <name>
  if (cliArgs.workspace) {
    const cmd = config.commands?.find(
      (c) => c.name === cliArgs.workspace && c.workspace,
    );
    if (cmd?.workspace) {
      await createWorkspaceFromDef(cmd.workspace);
    } else {
      console.warn(`[cli] Workspace "${cliArgs.workspace}" not found in config`);
      await createWorkspace(cliArgs.title || "Workspace 1");
    }
    return;
  }

  // 2. --path / --working-directory / --command
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

  // 3. Restore persisted workspaces from state.json.
  const state = await loadState();

  if (Array.isArray(state.workspaces)) {
    if (state.workspaces.length === 0) {
      // Explicit empty array — the user deleted every workspace on purpose.
      // The only valid "stay empty" sentinel: do NOT autoload or auto-default.
      return;
    }

    for (const def of state.workspaces) {
      const tpl = workspaceDefToTemplate(def);
      await createWorkspaceFromDef(tpl, { restoring: true });
    }

    const restored = get(workspaces);
    if (restored.length > 0) {
      let targetIdx = -1;
      const activeId = state.activeWorkspaceId;
      if (typeof activeId === "string") {
        targetIdx = restored.findIndex((w) => w.id === activeId);
      }
      if (targetIdx < 0) targetIdx = 0;
      switchWorkspace(targetIdx);
    }
    return;
  }

  // 4. autoload from config.
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

  // 5. auto-default. Reached only when state.workspaces was absent (undefined)
  // — an explicit empty array returned above.
  if (!autoloaded && get(workspaces).length === 0) {
    await createWorkspace("Workspace 1");
  }
}
