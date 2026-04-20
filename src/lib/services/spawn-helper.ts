/**
 * spawn-helper — shared "spawn an agent into a fresh worktree workspace"
 * pipeline. Invoked by:
 *   1. The MCP `spawn_agent` tool when its `worktree` flag is set.
 *   2. The in-app widgets (Issues split-button, TaskSpawner Spawn button)
 *      that need to produce the same effect without going through MCP.
 *
 * The helper:
 *   - Resolves branch/base defaults
 *   - Computes the worktree path (sibling of the repo, hyphen-joined branch)
 *   - Calls createWorktreeWorkspaceFromConfig (which creates the worktree,
 *     applies copyPatterns/setupScript, creates the workspace with metadata
 *     including parentOrchestratorId, and returns the new workspace id)
 *   - Sets the agent's startup command on the workspace's first terminal
 *     surface (already wired by createWorkspaceFromDef via WorkspaceDef.command)
 *
 * Branch defaulting (when caller doesn't pass a branch):
 *   `agent/<agent>/<shortTimestamp>` — base32 unix-seconds
 *
 * Quote escaping for taskContext in the startup command:
 *   We pass the task as a single quoted argument, and escape inner double
 *   quotes by closing the quote, inserting `"`, and reopening:
 *     foo "bar" baz   →   "foo \"bar\" baz"
 *   Backslashes are doubled so the shell sees a literal backslash.
 *   Newlines are preserved (most shells accept them inside double quotes).
 *
 * For agent="custom" the caller supplies the literal command verbatim — we
 * do NOT quote-wrap or inject taskContext (the caller is responsible).
 */
import { get } from "svelte/store";
import {
  createWorktreeWorkspaceFromConfig,
  type WorktreeWorkspaceConfig,
} from "./worktree-service";
import { workspaces } from "../stores/workspace";
import {
  getAllPanes,
  isTerminalSurface,
  type Pane,
  type Workspace,
} from "../types";

export type SpawnAgentType = "claude-code" | "codex" | "aider" | "custom";

const AGENT_COMMANDS: Record<Exclude<SpawnAgentType, "custom">, string> = {
  "claude-code": "claude",
  codex: "codex",
  aider: "aider",
};

export interface SpawnAgentInWorktreeArgs {
  /** Display name for the spawned workspace. */
  name: string;
  agent: SpawnAgentType;
  /** Required when agent === "custom". Ignored otherwise. */
  command?: string;
  /** Optional free-text task; prepended as the agent's first argument. */
  taskContext?: string;
  /**
   * Source repo path. When omitted, the caller has no context — error is
   * raised. (The MCP handler is responsible for resolving from the
   * connection binding before calling.)
   */
  repoPath: string;
  /** Branch name. Default: agent/<agent>/<shortTimestamp>. */
  branch?: string;
  /** Base branch. Default: "main". */
  base?: string;
  /**
   * When provided, the new workspace's metadata.parentOrchestratorId is
   * set to this id. The agentic-orchestrator extension claims the
   * workspace so it renders nested under the orchestrator row.
   */
  orchestratorId?: string;
  /**
   * When provided, the new workspace's metadata.groupId is set to this
   * id too — used when the spawning orchestrator lives under a workspace
   * group, so workspace-groups claims the worktree into the group's
   * nested list alongside other group workspaces.
   */
  groupId?: string;
}

export interface SpawnAgentInWorktreeResult {
  surface_id: string;
  workspace_id: string;
  pane_id: string;
  branch: string;
  worktree_path: string;
}

function shortTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString(36);
}

function defaultBranchFor(agent: SpawnAgentType): string {
  return `agent/${agent}/${shortTimestamp()}`;
}

function deriveWorktreePath(repoPath: string, branch: string): string {
  const trimmed = repoPath.replace(/\/+$/, "");
  const repoName = trimmed.split("/").pop() || "repo";
  const parentDir = trimmed.substring(0, trimmed.lastIndexOf("/"));
  const safeBranch = branch.replace(/\//g, "-");
  return `${parentDir}/${repoName}-${safeBranch}`;
}

/**
 * Quote a free-form task string for safe inclusion as a single shell
 * argument. Wraps in double quotes, escapes backslashes and inner double
 * quotes. Newlines are preserved as-is (the shell accepts them inside
 * double quotes; the agent receives the multi-line text).
 */
export function quoteTaskForShell(input: string): string {
  const escaped = input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function buildStartupCommand(
  agent: SpawnAgentType,
  taskContext: string | undefined,
  customCommand: string | undefined,
): string {
  if (agent === "custom") {
    if (!customCommand) {
      throw new Error('agent "custom" requires a command parameter');
    }
    // Custom commands pass through verbatim — caller owns the shape.
    return customCommand;
  }
  const base = AGENT_COMMANDS[agent];
  if (!base) {
    throw new Error(`unknown agent: ${agent}`);
  }
  if (!taskContext || !taskContext.trim()) {
    return base;
  }
  return `${base} ${quoteTaskForShell(taskContext)}`;
}

function findWorkspace(workspaceId: string): Workspace | undefined {
  return get(workspaces).find((w) => w.id === workspaceId);
}

function firstPaneAndTerminal(
  ws: Workspace,
): { pane: Pane; surfaceId: string } | null {
  const panes = getAllPanes(ws.splitRoot);
  for (const pane of panes) {
    for (const s of pane.surfaces) {
      if (isTerminalSurface(s)) {
        return { pane, surfaceId: s.id };
      }
    }
  }
  return null;
}

/**
 * Main entrypoint. Returns identifiers for the spawned workspace/pane/surface
 * so callers (MCP tool handler, widget handlers) can present them or chain
 * further actions.
 */
export async function spawnAgentInWorktree(
  args: SpawnAgentInWorktreeArgs,
): Promise<SpawnAgentInWorktreeResult> {
  if (!args.repoPath || !args.repoPath.trim()) {
    throw new Error(
      "spawnAgentInWorktree requires repoPath — caller must resolve from orchestrator.baseDir or workspace cwd",
    );
  }

  const branch = args.branch?.trim() || defaultBranchFor(args.agent);
  const base = args.base?.trim() || "main";
  const worktreePath = deriveWorktreePath(args.repoPath, branch);
  const startupCommand = buildStartupCommand(
    args.agent,
    args.taskContext,
    args.command,
  );

  const config: WorktreeWorkspaceConfig = {
    repoPath: args.repoPath,
    branch,
    base,
    worktreePath,
    startupCommand,
    ...(args.orchestratorId
      ? { parentOrchestratorId: args.orchestratorId }
      : {}),
    ...(args.groupId ? { groupId: args.groupId } : {}),
  };

  const { workspaceId } = await createWorktreeWorkspaceFromConfig(config);
  if (!workspaceId) {
    throw new Error(
      "spawnAgentInWorktree: failed to resolve workspace id after create",
    );
  }

  const ws = findWorkspace(workspaceId);
  if (!ws) {
    throw new Error(
      `spawnAgentInWorktree: workspace ${workspaceId} not found after create`,
    );
  }

  const placement = firstPaneAndTerminal(ws);
  if (!placement) {
    throw new Error(
      `spawnAgentInWorktree: no terminal pane in workspace ${workspaceId}`,
    );
  }

  // Override the surface name to reflect the spawn intent — createTerminalSurface
  // assigns "Shell N" by default. The WorkspaceDef path doesn't pass `name`
  // through (we only set `command`), so we rename here.
  for (const s of placement.pane.surfaces) {
    if (isTerminalSurface(s) && s.id === placement.surfaceId) {
      s.title = args.name;
    }
  }
  workspaces.update((l) => [...l]);

  return {
    surface_id: placement.surfaceId,
    workspace_id: workspaceId,
    pane_id: placement.pane.id,
    branch,
    worktree_path: worktreePath,
  };
}
