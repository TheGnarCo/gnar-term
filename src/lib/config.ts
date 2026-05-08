/**
 * GnarTerm Config — settings and runtime state
 *
 * Settings file locations (in priority order):
 *   ./settings.json                     (per-project)
 *   ./gnar-term.json                    (legacy per-project)
 *   ./cmux.json                         (per-project, cmux compat)
 *   ~/.config/gnar-term/settings.json   (global)
 *   ~/.config/gnar-term/gnar-term.json  (legacy global)
 *   ~/.config/cmux/cmux.json            (global, cmux compat)
 *
 * Runtime state:
 *   ~/.config/gnar-term/state.json      (written on quit, restored on launch)
 */

import { invoke } from "@tauri-apps/api/core";
import { writable, type Readable } from "svelte/store";
import { getHome, getConfigDir } from "./services/service-helpers";
import type { ThemeDef } from "./theme-data";

// --- Types (cmux-compatible + extensions) ---

export interface SurfaceDef {
  type?: "terminal" | "browser" | "extension" | "preview";
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  url?: string; // browser only
  /** Extension surface type id, e.g. "<extension-id>:<surface-id>". */
  extensionType?: string;
  /** Opaque props forwarded to the extension's surface component. */
  extensionProps?: Record<string, unknown>;
  /** Absolute path to the backing file for preview surfaces. */
  path?: string;
  focus?: boolean;
}

export interface PaneDef {
  surfaces: SurfaceDef[];
}

export interface SplitDef {
  direction: "horizontal" | "vertical";
  split?: number; // 0.1–0.9, default 0.5
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = { pane: PaneDef } | SplitDef;

export interface WorkspaceTemplate {
  /**
   * Stable identifier. Optional on fresh creation — `createWorkspaceFromDef`
   * mints a new id when absent. Populated by `persistWorkspaces` so that
   * on restart the same id is reused, letting `rootRowOrder` (which keys
   * rows by `{kind, id}`) survive the round-trip and preserve user-
   * dragged sort order.
   */
  id?: string;
  name?: string;
  cwd?: string;
  color?: string;
  env?: Record<string, string>;
  layout?: LayoutNode;
  rootWorkspaceId?: string;
  isDashboard?: boolean;
  dashboardContributionId?: string;
  dashboardWorkspaceId?: string;
  lastActiveBranchedWorkspaceId?: string;
  locked?: boolean;
  autoRunRestoreCommands?: boolean;
  path?: string;
  isGit?: boolean;
  createdAt?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  spawnedBy?:
    | { kind: "global" }
    | { kind: "workspace"; rootWorkspaceId: string };
  spawnedFromIssues?: number[];
  extensionData?: Record<string, unknown>;
}

/**
 * Serialized on-disk shape for a unified Workspace.
 *
 * `layout` carries the serialized paneLayout. Fields that don't apply
 * to a given kind of Workspace (e.g. `path`, `color` on Branches)
 * are omitted.
 */
export interface WorkspaceDef {
  id: string;
  name: string;
  layout: LayoutNode;
  // Workspace-level fields (path-rooted Workspaces only)
  path?: string;
  color?: string;
  isGit?: boolean;
  createdAt?: string;
  autoRunRestoreCommands?: boolean;
  // Navigation
  lastActiveBranchedWorkspaceId?: string;
  dashboardWorkspaceId?: string;
  // Membership / kind discriminants. `rootWorkspaceId` identifies
  // which Workspace this Branch (or Dashboard) belongs to.
  rootWorkspaceId?: string;
  isDashboard?: boolean;
  dashboardContributionId?: string;
  // Branch fields (worktree-backed Workspace variants provided by the
  // Branch Workspace extension)
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  repoPath?: string;
  // Flags
  locked?: boolean;
  // Extension data
  extensionData?: Record<string, unknown>;
}

export interface CommandDef {
  name: string;
  description?: string;
  keywords?: string[];
  command?: string; // simple shell command
  confirm?: boolean;
  restart?: "ignore" | "recreate" | "confirm";
  workspace?: WorkspaceTemplate; // workspace command
}

export interface ExtensionConfig {
  enabled: boolean;
  source?: string; // e.g. "github:TheGnarCo/gnar-term-ext-github-issues"
  settings?: Record<string, unknown>; // extension-specific settings values
}

export type McpSetting = "auto" | "on" | "off";

export interface WorktreeWorkspace {
  worktreePath: string;
  branch: string;
  baseBranch: string;
  repoPath: string;
  createdAt: string;
  workspaceId?: string;
}

export interface WorktreesSettings {
  branchPrefix?: string;
  copyPatterns?: string;
  setupScript?: string;
}

export interface WorktreesConfig {
  entries?: WorktreeWorkspace[];
  settings?: WorktreesSettings;
}

/**
 * Agent detection — user-tunable settings for core's passive agent
 * detection service (src/lib/services/agent-detection-service.ts).
 *
 * - `knownAgents`: additional pattern entries merged with the built-in
 *   list (Claude Code / Codex / Aider / Cursor / Copilot). Each entry
 *   is matched against PTY titles and streaming output.
 * - `idleTimeout`: seconds of no output before an active agent is
 *   reclassified as idle. Default 30.
 */
export interface AgentDetectionPattern {
  name: string;
  titlePatterns: string[];
  oscDetectable?: boolean;
}

export interface AgentsConfig {
  knownAgents?: AgentDetectionPattern[];
  idleTimeout?: number;
}

/**
 * Re-export the unified Workspace type as a convenience so old import sites
 * that import `Workspace` from this module continue to compile while we
 * migrate them to import from `../types` directly.
 */
export type { Workspace } from "./types";

/**
 * Re-export RootWorkspace from its canonical location so callers
 * that import from this module continue to compile. The canonical
 * definition lives in `./stores/workspaces`.
 */
export type { RootWorkspace } from "./stores/workspace";

export interface GnarTermConfig {
  // gnar-term extensions
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  shell?: string;
  autoload?: string[]; // workspace command names to launch on startup
  extensions?: Record<string, ExtensionConfig>;
  worktrees?: WorktreesConfig;
  agents?: AgentsConfig;
  /**
   * Per-pseudo-workspace color overrides, keyed by pseudo id
   * (e.g. `"agentic.global"`). Values are slot names from
   * `WORKSPACE_COLOR_SLOTS` (same palette Workspaces use) or any
   * `#RRGGBB` literal. Consumed by `PseudoWorkspaceRow` to paint the
   * banner; absent entries fall back to a theme-neutral default.
   */
  pseudoWorkspaceColors?: Record<string, string>;
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
  /** User-imported themes keyed by id. Registered at boot in App.svelte. */
  userThemes?: Record<string, ThemeDef>;
  // cmux-compatible
  commands?: CommandDef[];
}

export interface AppState {
  windowBounds?: { x?: number; y?: number; width?: number; height?: number };
  workspaces?: WorkspaceDef[];
  activeWorkspaceId?: string;
  // Interleaved ordering for the Workspaces section. See stores/root-row-order.ts.
  rootRowOrder?: { kind: string; id: string }[];
  // Archived (suspended) workspaces. See stores/archive.ts.
  archivedOrder?: string[];
  archivedDefs?: {
    workspaces: Record<string, ArchivedWorkspaceDef>;
  };
  // Primary sidebar expanded (true) / collapsed (false). See stores/ui.ts
  // and services/sidebar-persistence-service.ts.
  sidebarVisible?: boolean;
}

export interface ArchivedWorkspaceDef {
  workspace: import("./stores/workspace").RootWorkspace;
  childWorkspaceDefs: (WorkspaceTemplate & { name: string })[];
}

// --- Config file paths ---

const CONFIG_FILENAMES = [
  "settings.json",
  "gnar-term.json", // legacy
  "cmux.json",
];

// --- Read/Write via Rust backend ---

let _config: GnarTermConfig = {};
let _configPath = "";
const _configStore = writable<GnarTermConfig>({});
export const configStore: Readable<GnarTermConfig> = _configStore;

/**
 * Bring a legacy on-disk config forward to dev's shape. Only rewrites
 * the deltas that would otherwise break behavior on load:
 *   - `SurfaceDef.type === "markdown"` → `"preview"` (the markdown
 *     surface kind was folded into the unified preview surface; the
 *     `path` field is identical, so the rest of the def survives).
 * Other dropped fields (e.g. `opacity`) are tolerated as ignored keys.
 */
export function migrateLoadedConfig(raw: unknown): GnarTermConfig {
  if (!raw || typeof raw !== "object") return {} as GnarTermConfig;
  const cfg = raw as GnarTermConfig;
  if (Array.isArray(cfg.commands)) {
    for (const cmd of cfg.commands) {
      if (cmd?.workspace?.layout) {
        migrateLayoutSurfaceTypes(cmd.workspace.layout);
      }
    }
  }
  return cfg;
}

function migrateLayoutSurfaceTypes(node: LayoutNode): void {
  if ("pane" in node) {
    for (const surface of node.pane.surfaces) {
      // `"markdown"` is not in dev's SurfaceDef union; cast through unknown
      // so the migration check compiles without widening the public type.
      if ((surface.type as unknown as string) === "markdown") {
        surface.type = "preview";
      }
    }
    return;
  }
  migrateLayoutSurfaceTypes(node.children[0]);
  migrateLayoutSurfaceTypes(node.children[1]);
}

export async function loadConfig(
  explicitPath?: string,
): Promise<GnarTermConfig> {
  // If an explicit config path was provided (e.g. via --config), try it first
  if (explicitPath) {
    try {
      const content = await invoke<string>("read_file", { path: explicitPath });
      _config = migrateLoadedConfig(JSON.parse(content));
      _configPath = explicitPath;
      _configStore.set(_config);
      return _config;
    } catch (e) {
      console.warn(`[config] Failed to load ${explicitPath}:`, e);
    }
  }

  const [home, configDir] = await Promise.all([getHome(), getConfigDir()]);

  // Try per-project config first (higher priority), then global.
  // Legacy global `gnar-term.json` is still read so existing installs keep
  // working after the rename to `settings.json`.
  const paths = [
    ...CONFIG_FILENAMES, // ./settings.json, ./gnar-term.json, ./cmux.json
    `${configDir}/settings.json`,
    `${configDir}/gnar-term.json`,
    `${home}/.config/cmux/cmux.json`,
  ];

  for (const path of paths) {
    try {
      const content = await invoke<string>("read_file", { path });
      _config = migrateLoadedConfig(JSON.parse(content));
      _configPath = path;
      _configStore.set(_config);
      return _config;
    } catch {}
  }

  // No config found — use defaults
  _config = {};
  _configPath = `${configDir}/settings.json`;
  _configStore.set(_config);
  return _config;
}

export async function saveConfig(
  updates: Partial<GnarTermConfig>,
): Promise<void> {
  _config = { ..._config, ...updates };
  _configStore.set(_config);
  const configDir = await getConfigDir();
  const path = _configPath || `${configDir}/settings.json`;

  // Ensure directory exists
  try {
    await invoke("ensure_dir", { path: configDir });
  } catch {}

  try {
    await invoke("write_file", {
      path,
      content: JSON.stringify(_config, null, 2),
    });
  } catch (err) {
    console.error("[config] Failed to save:", err);
  }
}

export function getConfig(): GnarTermConfig {
  return _config;
}

export function getMcpSetting(): McpSetting {
  const v = _config.mcp;
  if (v === "on" || v === "off" || v === "auto") return v;
  return "auto";
}

export function getWorkspaceCommands(): CommandDef[] {
  return (_config.commands || []).filter((c) => c.workspace);
}

// --- Runtime state ---

let _appState: AppState = {};
const _appStateStore = writable<AppState>({});
export const appStateStore: Readable<AppState> = _appStateStore;

export async function loadState(): Promise<AppState> {
  const configDir = await getConfigDir();
  const path = `${configDir}/state.json`;
  try {
    const content = await invoke<string>("read_file", { path });
    _appState = JSON.parse(content) as AppState;
  } catch {
    _appState = {};
  }

  _appStateStore.set(_appState);
  return _appState;
}

export async function saveState(updates: Partial<AppState>): Promise<void> {
  _appState = { ..._appState, ...updates };
  _appStateStore.set(_appState);
  const configDir = await getConfigDir();
  const path = `${configDir}/state.json`;
  try {
    await invoke("ensure_dir", { path: configDir });
    await invoke("write_file", {
      path,
      content: JSON.stringify(_appState, null, 2),
    });
  } catch (err) {
    console.error("[state] Failed to save:", err);
  }
}

export function getState(): AppState {
  return _appState;
}

// getHome is imported from service-helpers
