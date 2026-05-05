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
import type { WorkspaceMetadata } from "./types";
import type { ThemeDef } from "./theme-data";
import type { WorkspaceRecord } from "./stores/workspace";

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
  metadata?: WorkspaceMetadata;
  layout?: LayoutNode;
}

/**
 * Serialized on-disk shape for a unified Workspace (new format).
 * Today this carries Branches and Dashboards; path-rooted Workspace
 * records still persist separately in `parentWorkspaces` until the
 * runtime type unification lands. The `layout` field carries the
 * serialized splitRoot. Fields that don't apply to a given record
 * (e.g. `path`, `color` on Branches) are omitted.
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
  // Membership / kind discriminants. `parentWorkspaceId` is the legacy
  // name for "id of the Workspace this Branch (or Dashboard) belongs to".
  parentWorkspaceId?: string;
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
  mergeStrategy?: "merge" | "squash" | "rebase";
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
 * Re-export WorkspaceRecord from its canonical location so callers
 * that import from this module continue to compile. The canonical
 * definition lives in `./stores/workspaces`.
 */
export type { WorkspaceRecord } from "./stores/workspace";

export interface GnarTermConfig {
  // gnar-term extensions
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  opacity?: number;
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
  sidebarWidths?: { primary?: number; secondary?: number };
  sidebarVisible?: { primary?: boolean; secondary?: boolean };
  windowBounds?: { x?: number; y?: number; width?: number; height?: number };
  workspaces?: WorkspaceDef[];
  activeWorkspaceId?: string;
  workspaceOrder?: { kind: string; id: string }[];
  // Interleaved ordering for the Workspaces section. See stores/root-row-order.ts.
  rootRowOrder?: { kind: string; id: string }[];
  // Archived (suspended) workspaces. See stores/archive.ts.
  archivedOrder?: string[];
  archivedDefs?: {
    workspaces: Record<string, ArchivedWorkspaceDef>;
  };
  // The WorkspaceRecord list — the path-rooted container records that
  // own Workspace-level fields (path, color, isGit) and track which
  // Branches belong to them. Persisted under the legacy keys
  // `parentWorkspaces` / `activeParentWorkspaceId` until the runtime
  // type unification renames the storage; migrated into AppState in
  // Stage 8 from the legacy per-extension state file
  // `~/.config/gnar-term/extensions/workspace-groups/state.json`.
  parentWorkspaces?: WorkspaceRecord[];
  activeParentWorkspaceId?: string;
}

export interface ArchivedWorkspaceDef {
  workspace: WorkspaceRecord;
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

export async function loadConfig(
  explicitPath?: string,
): Promise<GnarTermConfig> {
  // If an explicit config path was provided (e.g. via --config), try it first
  if (explicitPath) {
    try {
      const content = await invoke<string>("read_file", { path: explicitPath });
      _config = JSON.parse(content) as GnarTermConfig;
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
      _config = JSON.parse(content) as GnarTermConfig;
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

export function getCommands(): CommandDef[] {
  return _config.commands || [];
}

export function getMcpSetting(): McpSetting {
  const v = _config.mcp;
  if (v === "on" || v === "off" || v === "auto") return v;
  return "auto";
}

export function getWorkspaceCommands(): CommandDef[] {
  return getCommands().filter((c) => c.workspace);
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

  // Pre-Stage-9 → Stage-9: fold legacy WorkspaceRecord records into the
  // unified state.workspaces[] list. Idempotent — short-circuits when
  // there are no parentWorkspaces. The migrated state is written back to
  // disk so future loads bypass the migration.
  const { migrateLegacyWorkspaces } =
    await import("./bootstrap/migrate-legacy-workspaces");
  const migrated = migrateLegacyWorkspaces(_appState);
  if (migrated !== _appState) {
    _appState = migrated;
    try {
      await invoke("ensure_dir", { path: configDir });
      await invoke("write_file", {
        path,
        content: JSON.stringify(_appState, null, 2),
      });
    } catch (err) {
      console.error("[state] Failed to persist migrated state:", err);
    }
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
