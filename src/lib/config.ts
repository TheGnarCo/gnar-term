/**
 * GnarTerm Config — cmux-compatible with extensions
 *
 * File locations (in priority order):
 *   ./gnar-term.json        (per-project)
 *   ~/.config/gnar-term/gnar-term.json  (global)
 *   ./cmux.json             (per-project, cmux compat)
 *   ~/.config/cmux/cmux.json (global, cmux compat)
 */

import { invoke } from "@tauri-apps/api/core";
import {
  isTerminalSurface,
  isPreviewSurface,
  type Workspace,
  type SplitNode,
} from "./types";

// --- Types (cmux-compatible + extensions) ---

export interface SurfaceDef {
  type?: "terminal" | "browser" | "markdown";  // "markdown" is gnar-term extension
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  url?: string;       // browser only
  path?: string;      // markdown only (gnar-term extension)
  focus?: boolean;
}

export interface PaneDef {
  surfaces: SurfaceDef[];
}

export interface SplitDef {
  direction: "horizontal" | "vertical";
  split?: number;  // 0.1–0.9, default 0.5
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = { pane: PaneDef } | SplitDef;

export interface WorkspaceDef {
  /**
   * Stable identifier. Optional on fresh creation; populated when persisting
   * a live workspace so its `workspaceOrder` row (keyed by `{kind, id}`)
   * survives a round-trip and preserves user-dragged sort order.
   */
  id?: string;
  name?: string;
  cwd?: string;
  color?: string;
  layout?: LayoutNode;
  // --- Grouping fields (in-scope subset; dashboards/controlled/ssh dropped) ---
  /** Anchor back-reference — presence marks this def as a group member. */
  anchorWorkspaceId?: string;
  /** Ordered member ids on an anchor (ordering only; membership via tag). */
  memberWorkspaceIds?: string[];
  /** Last member of this group the user touched (nav convenience). */
  lastActiveMemberWorkspaceId?: string;
  /** Filesystem path this workspace is rooted at, when path-rooted. */
  path?: string;
  /** True when `path` is a git repository. */
  isGit?: boolean;
  /** Locked workspaces resist close/delete. */
  locked?: boolean;
  /** ISO creation timestamp. */
  createdAt?: string;
  /** Git-worktree backing (a property of any workspace, not a kind). */
  worktree?: {
    path: string;
    branch: string;
    baseBranch?: string;
    repoPath?: string;
  };
}

/**
 * Persisted application state (state.json). Stage 1 defines the shape (the
 * in-scope fields only); the live load/save wiring lands in Stage 2.
 *
 * Out-of-scope fields (archive, dashboards, ssh) are intentionally absent.
 */
export interface AppState {
  workspaces?: WorkspaceDef[];
  activeWorkspaceId?: string;
  /** Interleaved ordering for the Workspaces section. */
  workspaceOrder?: { kind: string; id: string }[];
  /** Per-group collapsed flag, keyed by anchor id. */
  groupCollapsedById?: Record<string, boolean>;
  /** Primary sidebar expanded (true) / collapsed (false). */
  sidebarVisible?: boolean;
}

export interface CommandDef {
  name: string;
  description?: string;
  keywords?: string[];
  command?: string;       // simple shell command
  confirm?: boolean;
  restart?: "ignore" | "recreate" | "confirm";
  workspace?: WorkspaceDef;  // workspace command
}

export type McpSetting = "auto" | "on" | "off";

export interface GnarTermConfig {
  // gnar-term extensions
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  opacity?: number;
  autoload?: string[];  // workspace command names to launch on startup
  /**
   * MCP integration module. Controls whether gnar-term exposes its MCP tools
   * to Claude Code (or any other MCP client) over a local Unix domain socket.
   *
   * - "auto" (default): enable when Claude Code is detected on PATH or
   *   ~/.claude.json exists; otherwise dormant.
   * - "on": always attempt to enable. Shows a one-time warning if Claude
   *   Code can't be detected.
   * - "off": hard opt-out. No socket is bound, no files outside gnar-term's
   *   own config are touched.
   */
  mcp?: McpSetting;
  // cmux-compatible
  commands?: CommandDef[];
}

// --- Config file paths ---

const CONFIG_FILENAMES = [
  "gnar-term.json",
  "cmux.json",
];

// --- Read/Write via Rust backend ---

let _config: GnarTermConfig = {};
let _configPath = "";

export async function loadConfig(explicitPath?: string): Promise<GnarTermConfig> {
  // If an explicit config path was provided (e.g. via --config), try it first
  if (explicitPath) {
    try {
      const content = await invoke<string>("read_file", { path: explicitPath });
      _config = JSON.parse(content);
      _configPath = explicitPath;
      return _config;
    } catch (e) {
      console.warn(`[config] Failed to load ${explicitPath}:`, e);
    }
  }

  const home = await getHome();

  // Try per-project config first (higher priority), then global
  const paths = [
    ...CONFIG_FILENAMES,  // ./gnar-term.json, ./cmux.json
    `${home}/.config/gnar-term/gnar-term.json`,
    `${home}/.config/cmux/cmux.json`,
  ];

  for (const path of paths) {
    try {
      const content = await invoke<string>("read_file", { path });
      _config = JSON.parse(content);
      _configPath = path;
      return _config;
    } catch {}
  }

  // No config found — use defaults
  _config = {};
  _configPath = `${home}/.config/gnar-term/gnar-term.json`;
  return _config;
}

export async function saveConfig(updates: Partial<GnarTermConfig>): Promise<void> {
  _config = { ..._config, ...updates };
  const home = await getHome();
  const path = _configPath || `${home}/.config/gnar-term/gnar-term.json`;

  // Ensure directory exists
  try {
    await invoke("ensure_dir", { path: `${home}/.config/gnar-term` });
  } catch {}

  try {
    await invoke("write_file", { path, content: JSON.stringify(_config, null, 2) });
  } catch (err) {
    console.error("[config] Failed to save:", err);
  }
}

export function getConfig(): GnarTermConfig {
  return _config;
}

export function getCommands(): CommandDef[] {
  return _config.commands || [];
}

export function getMcpSetting(): McpSetting {
  const v = _config.mcp;
  if (v === "on" || v === "off" || v === "auto") return v;
  return "auto";
}

export function getWorkspaceCommands(): CommandDef[] {
  return getCommands().filter(c => c.workspace);
}

// --- Serialization ---

/**
 * Serialize a live split tree to its on-disk `LayoutNode` form. Only the two
 * in-scope surface contents are emitted: terminal and preview (Browser panel).
 * SSH and registry surface branches are intentionally absent.
 */
export function serializeLayout(node: SplitNode): LayoutNode {
  if (node.type === "pane") {
    const surfaces: SurfaceDef[] = node.pane.surfaces.map((s) => {
      if (isTerminalSurface(s)) {
        const def: SurfaceDef = { type: "terminal" };
        if (s.title) def.name = s.title;
        if (s.cwd) def.cwd = s.cwd;
        if (s.startupCommand) def.command = s.startupCommand;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      }
      // Preview surface → Browser panel, serialized as a markdown surface.
      const def: SurfaceDef = { type: "markdown" };
      if (s.title) def.name = s.title;
      if (isPreviewSurface(s)) def.path = s.filePath;
      if (s.id === node.pane.activeSurfaceId) def.focus = true;
      return def;
    });
    return { pane: { surfaces } };
  }
  return {
    direction: node.direction,
    split: node.ratio,
    children: [serializeLayout(node.children[0]), serializeLayout(node.children[1])],
  };
}

/**
 * Serialize a live `Workspace` to its on-disk `WorkspaceDef`. Only in-scope
 * fields are written; dashboard / controlled / ssh fields are never emitted.
 */
export function serializeWorkspace(ws: Workspace): WorkspaceDef {
  const def: WorkspaceDef = {
    id: ws.id,
    name: ws.name,
    layout: serializeLayout(ws.splitRoot),
  };
  if (ws.anchorWorkspaceId !== undefined)
    def.anchorWorkspaceId = ws.anchorWorkspaceId;
  if (ws.memberWorkspaceIds !== undefined)
    def.memberWorkspaceIds = ws.memberWorkspaceIds;
  if (ws.lastActiveMemberWorkspaceId !== undefined)
    def.lastActiveMemberWorkspaceId = ws.lastActiveMemberWorkspaceId;
  if (ws.path !== undefined) def.path = ws.path;
  if (ws.color !== undefined) def.color = ws.color;
  if (ws.isGit !== undefined) def.isGit = ws.isGit;
  if (ws.locked !== undefined) def.locked = ws.locked;
  if (ws.createdAt !== undefined) def.createdAt = ws.createdAt;
  if (ws.worktree !== undefined) def.worktree = ws.worktree;
  return def;
}

/**
 * Convert an on-disk `WorkspaceDef` back into the `WorkspaceDef` template the
 * runtime `createWorkspaceFromDef` path hydrates. In-scope fields only —
 * dashboard / controlled / ssh copies are stripped.
 */
export function workspaceDefToTemplate(def: WorkspaceDef): WorkspaceDef {
  const tpl: WorkspaceDef = {
    id: def.id,
    name: def.name,
    layout: def.layout,
  };
  if (def.cwd !== undefined) tpl.cwd = def.cwd;
  if (def.color !== undefined) tpl.color = def.color;
  if (def.anchorWorkspaceId !== undefined)
    tpl.anchorWorkspaceId = def.anchorWorkspaceId;
  if (def.memberWorkspaceIds !== undefined)
    tpl.memberWorkspaceIds = def.memberWorkspaceIds;
  if (def.lastActiveMemberWorkspaceId !== undefined)
    tpl.lastActiveMemberWorkspaceId = def.lastActiveMemberWorkspaceId;
  if (def.path !== undefined) tpl.path = def.path;
  if (def.isGit !== undefined) tpl.isGit = def.isGit;
  if (def.locked !== undefined) tpl.locked = def.locked;
  if (def.createdAt !== undefined) tpl.createdAt = def.createdAt;
  if (def.worktree !== undefined) tpl.worktree = def.worktree;
  return tpl;
}

// --- Helpers ---

let _home = "";
async function getHome(): Promise<string> {
  if (_home) return _home;
  try {
    _home = await invoke<string>("get_home");
  } catch {
    _home = "/tmp";
  }
  return _home;
}
