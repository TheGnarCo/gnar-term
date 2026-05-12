/**
 * spawn-helper — shared "spawn an agent into a fresh branched workspace"
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
 *     including spawnedBy, and returns the new workspace id)
 *   - Sets the agent's startup command on the workspace's first terminal
 *     surface (already wired by createWorkspaceFromDef via WorkspaceTemplate.command)
 *
 * Branch defaulting (when caller doesn't pass a branch):
 *   `agent/<agent>/<shortTimestamp>` — base32 unix-seconds
 *
 * Quote escaping for taskContext in the startup command:
 *   We use ANSI-C $'...' quoting so newlines become \n escape sequences.
 *   This avoids literal newlines in the command string, which the PTY
 *   line discipline would split into separate lines before the shell can
 *   reassemble them in PS2 continuation mode.
 *     foo 'bar' baz   →   $'foo \'bar\' baz'
 *   Backslashes are doubled; single quotes are escaped with \'.
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
import { getConfig } from "../config";
import {
  getAllPanes,
  isTerminalSurface,
  type Pane,
  type Workspace,
} from "../types";

/**
 * Spawn-side agent taxonomy. Distinct from the detection-side `AgentType`
 * (see `agent-type.ts`) because the detector recognises more agents than
 * the spawn helper has built-in launchers for. Anything outside this set
 * goes through `"custom"` with a literal command supplied by the caller.
 *
 * SPAWN_AGENT_TYPES is the runtime array of the same values — exported so
 * MCP tool schemas can reuse it for their `enum` arrays without spelling
 * the literals out again.
 */
export const SPAWN_AGENT_TYPES = [
  "claude-code",
  "codex",
  "aider",
  "custom",
] as const;
export type SpawnAgentType = (typeof SPAWN_AGENT_TYPES)[number];

const AGENT_COMMANDS: Record<Exclude<SpawnAgentType, "custom">, string> = {
  "claude-code": "claude",
  codex: "codex",
  aider: "aider",
};

/**
 * Map `AgentPreset.intendedAgent` (detection-side AgentType) onto the
 * spawn-helper's SpawnAgentType. Detection identifies more agents than the
 * spawn helper has built-in launchers for — anything that doesn't map falls
 * back to "custom" so the preset's literal command is honored verbatim.
 */
const INTENDED_AGENT_TO_SPAWN_TYPE: Record<string, SpawnAgentType> = {
  claude: "claude-code",
  codex: "codex",
  aider: "aider",
};

/**
 * Resolved view of an `AgentPreset` ready to feed into either spawn path
 * (worktree branch or ad-hoc pane). The worktree path ignores `cwd` —
 * it uses the worktree directory — but the non-worktree path honors it
 * as the working directory hint for the new terminal surface.
 */
export interface ResolvedAgentPreset {
  type: SpawnAgentType;
  /** Literal launcher command, e.g. `"claude --model opus"`. */
  command: string;
  /** First-arg task context (becomes the agent's initial prompt). */
  taskContext?: string;
  /** Working directory hint for non-worktree spawns. */
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Resolve a preset name from `settings.json#agents[]` into spawn args.
 * Throws when the preset is missing. Honors every preset field that
 * affects a spawn:
 *   - `intendedAgent` → SpawnAgentType (falls back to "custom")
 *   - `command` → literal launcher
 *   - `initialPrompt` → taskContext (prepended to the launcher)
 *   - `defaultCwd` → cwd hint for ad-hoc / non-worktree spawns
 *   - `env` → env vars
 */
export function resolveAgentPresetForSpawn(
  presetName: string,
): ResolvedAgentPreset {
  const presets = getConfig().agents ?? [];
  const preset = presets.find((p) => p.name === presetName);
  if (!preset) {
    throw new Error(
      `agent preset "${presetName}" not found in settings.json agents[]`,
    );
  }
  let type: SpawnAgentType = "custom";
  if (preset.intendedAgent) {
    const mapped = INTENDED_AGENT_TO_SPAWN_TYPE[preset.intendedAgent];
    if (mapped) {
      type = mapped;
    } else {
      console.warn(
        `[spawn-helper] preset "${preset.name}" intendedAgent="${preset.intendedAgent}" has no SpawnAgentType mapping; falling back to "custom" — preset.command will be used verbatim`,
      );
    }
  }
  const resolved: ResolvedAgentPreset = {
    type,
    command: preset.command,
  };
  if (preset.initialPrompt !== undefined && preset.initialPrompt !== "") {
    resolved.taskContext = preset.initialPrompt;
  }
  if (preset.defaultCwd !== undefined && preset.defaultCwd !== "") {
    resolved.cwd = preset.defaultCwd;
  }
  if (preset.env && Object.keys(preset.env).length > 0) {
    resolved.env = preset.env;
  }
  return resolved;
}

/**
 * Find the first `AgentPreset` with `autoSpawn: true` in `settings.json#agents[]`
 * and return its resolved spawn shape. Returns `null` when no preset opts in.
 *
 * First-match policy is intentional — the presets array is ordered, so the
 * user controls priority by editing settings.json. Resolution delegates to
 * `resolveAgentPresetForSpawn` so there is exactly one place that turns a
 * preset record into a spawn payload (single source of truth).
 */
export function resolveAutoSpawnPreset(): ResolvedAgentPreset | null {
  const presets = getConfig().agents ?? [];
  const preset = presets.find((p) => p.autoSpawn === true);
  if (!preset) return null;
  return resolveAgentPresetForSpawn(preset.name);
}

/**
 * Provenance marker attached to workspaces spawned from a dashboard.
 * Mirrors `metadata.spawnedBy` on the created workspace and ultimately
 * drives the bot-icon affordance in the sidebar. See spec §3.2 / §5.3.
 */
export type SpawnedByMarker =
  | { kind: "global" }
  | { kind: "workspace"; rootWorkspaceId: string };

export interface SpawnAgentInWorktreeArgs {
  /** Display name for the spawned workspace. */
  name: string;
  agent: SpawnAgentType;
  /**
   * Literal command override. Required when agent === "custom". For built-in
   * agent types it is optional — when present, it replaces the AGENT_COMMANDS
   * default (used by AgentPreset to thread `claude --model opus` etc.).
   */
  command?: string;
  /** Optional free-text task; prepended as the agent's first argument. */
  taskContext?: string;
  /**
   * Extra environment variables to merge into the spawned workspace's root env.
   * Honored alongside the worktree-service's GNARTERM_WORKTREE_ROOT default.
   */
  env?: Record<string, string>;
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
   * When provided, the new Branch's `rootWorkspaceId` is set to this id —
   * used when the spawning dashboard lives under a Workspace, so the
   * worktree is attached to that Workspace alongside other Branches.
   */
  rootWorkspaceId?: string;
  /**
   * Provenance marker — the new workspace's metadata.spawnedBy records
   * which dashboard spawned it. Presence drives the bot-icon treatment
   * in the sidebar; shape supports later "jump to spawner" affordances.
   */
  spawnedBy?: SpawnedByMarker;
  /**
   * GitHub issue numbers this workspace is handling. Forwarded to
   * `metadata.spawnedFromIssues` so the Issues widget can render a
   * bot-icon button (jump to the active workspace) instead of the
   * Spawn affordance for issues that already have an agent on them.
   * "Spawn Together" multi-issue spawns write multiple numbers here.
   */
  spawnedFromIssues?: number[];
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

/**
 * Derive a default worktree path from the repo path and branch name.
 * Pattern: `<parent-of-repo>/<repo-basename>-<branch-hyphenated>`.
 *
 * Exported because three call sites used to hand-roll this with
 * subtly different regex (Unix-only vs cross-platform); the shared
 * implementation accepts both `/` and `\` separators so windows-style
 * repo paths don't collapse to "/repo-<branch>".
 */
export function deriveWorktreePath(repoPath: string, branch: string): string {
  const normalised = repoPath.replace(/[/\\]+$/, "");
  const parts = normalised.split(/[/\\]/);
  const repoName = parts[parts.length - 1] || "repo";
  const parent = parts.slice(0, -1).join("/") || "/";
  const safeBranch = branch.replace(/[/\\]/g, "-");
  return `${parent}/${repoName}-${safeBranch}`;
}

/**
 * Quote a free-form task string for safe inclusion as a single shell
 * argument. Uses ANSI-C $'...' quoting so newlines are encoded as \n
 * escape sequences — no literal newlines appear in the command string.
 * This prevents the PTY line discipline from splitting the command at
 * each newline before the shell can reassemble it in PS2 continuation mode.
 */
export function quoteTaskForShell(input: string): string {
  const escaped = input
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(
      /[\x00-\x1f\x7f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  return `$'${escaped}'`;
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
    return customCommand;
  }
  // Built-in agents: caller may override the launcher (e.g. AgentPreset
  // supplies `claude --model opus`). When no override is given, fall back
  // to the canonical binary name.
  const base = customCommand?.trim() || AGENT_COMMANDS[agent];
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
  const panes = getAllPanes(ws.paneLayout);
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
    controlled: true,
    ...(args.env && Object.keys(args.env).length > 0 ? { env: args.env } : {}),
    ...(args.rootWorkspaceId ? { rootWorkspaceId: args.rootWorkspaceId } : {}),
    ...(args.spawnedBy ? { spawnedBy: args.spawnedBy } : {}),
    ...(args.spawnedFromIssues && args.spawnedFromIssues.length > 0
      ? { spawnedFromIssues: args.spawnedFromIssues }
      : {}),
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
  // assigns "Shell N" by default. The WorkspaceTemplate path doesn't pass `name`
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
