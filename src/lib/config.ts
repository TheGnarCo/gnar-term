/**
 * GnarTerm Config — settings and runtime state
 *
 * Settings file locations (in priority order):
 *   ./gnar-term.json                    (per-project; canonical write target)
 *   ./.gnar-term                        (per-project; one-shot migration → ./gnar-term.json)
 *   ./cmux.json                         (per-project; one-shot migration → ./gnar-term.json)
 *   ~/.config/gnar-term/gnar-term.json  (global; canonical write target)
 *   ~/.config/gnar-term/cmux.json       (global; one-shot migration → global gnar-term.json)
 *   ~/.config/cmux/cmux.json            (global; one-shot migration → global gnar-term.json)
 *
 * `settings.json` is no longer supported at any path — never read, never written.
 *
 * Runtime state:
 *   ~/.config/gnar-term/state.json      (written on quit, restored on launch)
 */

import { invoke } from "@tauri-apps/api/core";
import { writable, type Readable } from "svelte/store";
import { getHome, getConfigDir } from "./services/service-helpers";
import type { ThemeDef } from "./theme-data";
import { migrateAgentsConfig, type AgentPreset } from "./agents-config";

// --- Types (cmux-compatible + extensions) ---

export interface SurfaceDef {
  type?: "terminal" | "browser" | "extension" | "preview" | "registry" | "ssh";
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
  /**
   * SSH surface config. Present when `type === "ssh"`. Persisted so the
   * SSH connection can be re-spawned on workspace reload.
   */
  sshConfig?: import("./surfaces/ssh-surface").SshSurfaceConfig;
}

export interface PaneDef {
  surfaces: SurfaceDef[];
  /**
   * Optional intended agent hint. Round-trips through serialize/hydrate.
   * The detection service prefers confirmed detection over this value.
   */
  intendedAgent?: import("./services/agent-type").AgentType;
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
  dismissedDashboardContributionIds?: string[];
  enabledDashboardContributionIds?: string[];
  lastActiveBranchedWorkspaceId?: string;
  locked?: boolean;
  autoRunRestoreCommands?: boolean;
  path?: string;
  pathInode?: number;
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
  /**
   * Set when this workspace template represents an agentic-Controlled
   * Workspace (spawned via MCP / agentic dashboard / spawn-helper).
   * Round-trips through serialize/hydrate via `WorkspaceDef.controlled`.
   */
  controlled?: boolean;
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
  /**
   * Inode of `path` at last successful sweep — persisted so rename
   * detection still works for renames that happened while gnar-term
   * was closed. See `validateWorkspaceRootPaths`.
   */
  pathInode?: number;
  color?: string;
  isGit?: boolean;
  createdAt?: string;
  autoRunRestoreCommands?: boolean;
  // Navigation
  lastActiveBranchedWorkspaceId?: string;
  dashboardWorkspaceId?: string;
  /**
   * Dashboard contribution ids the user has dismissed on this root
   * Workspace — `defaultEnabled` contributions in this list are NOT
   * re-provisioned on reconcile. Persisted so the dismissal survives
   * restart.
   */
  dismissedDashboardContributionIds?: string[];
  /**
   * Dashboard contribution ids the user has explicitly enabled on this
   * root Workspace via Workspace Settings. Drives chip presence for
   * opt-in (neither autoProvision nor defaultEnabled) contributions.
   * Persisted so the enabled state survives restart.
   */
  enabledDashboardContributionIds?: string[];
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
  /**
   * Persisted "Controlled Workspace" marker. True when the workspace
   * was spawned through the agentic flow (MCP `spawn_branch`, agentic
   * dashboard, or spawn-helper). Drives lifecycle-pill visibility and
   * agentic-dashboard participation. Absent / false on manually-
   * created branches.
   */
  controlled?: boolean;
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
  /**
   * Number of days of inactivity (no git commits, no agent running, no PR)
   * after which a Worktree Branch is classified as `abandoned`.
   * Default: 14.
   */
  abandonedAfterDays?: number;
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

export { type AgentPreset } from "./agents-config";

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
  /**
   * Agent detection settings — user-tunable pattern entries and idle
   * timeout for the passive agent-detection service.
   */
  agentDetection?: AgentsConfig;
  /**
   * Agent spawn presets — launchable agent configurations shown in the
   * command palette. Different concept from `agentDetection`.
   */
  agents?: AgentPreset[];
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
  // Per-banner collapsed flag, keyed by SidebarBanner.scopeId (workspace
  // id for root banners). Missing entries default to collapsed; an
  // explicit `false` keeps a banner expanded across launches. See
  // services/sidebar-persistence-service.ts.
  bannerCollapsedById?: Record<string, boolean>;
}

export interface ArchivedWorkspaceDef {
  workspace: import("./stores/workspace").RootWorkspace;
  childWorkspaceDefs: (WorkspaceTemplate & { name: string })[];
}

// --- Read/Write via Rust backend ---

let _config: GnarTermConfig = {};
let _configPath = "";
const _configStore = writable<GnarTermConfig>({});
export const configStore: Readable<GnarTermConfig> = _configStore;

/**
 * Migration map — transforms an on-disk config into the current shape on
 * load. Only rewrites the deltas that would otherwise break behavior:
 *   - `SurfaceDef.type === "markdown"` → `"preview"` (the markdown
 *     surface kind was folded into the unified preview surface; the
 *     `path` field is identical, so the rest of the def survives).
 *   - `agents` (detection shape) → `agentDetection`, with the new
 *     `agents[]` preset array taking the freed name. See
 *     `migrateAgentsConfig`.
 * Other dropped fields (e.g. `opacity`) are tolerated as ignored keys.
 */
export function migrateLoadedConfig(raw: unknown): GnarTermConfig {
  if (!raw || typeof raw !== "object") return {} as GnarTermConfig;

  // Migrate agents field: old detection shape → agentDetection; new preset
  // array → stays as agents. Returns normalised sub-fields + remaining keys.
  const { agentDetection, agents, otherFields } = migrateAgentsConfig(raw);

  // Rebuild the config object with migrated fields. We spread otherFields first
  // so that any top-level keys we don't explicitly manage are preserved for
  // round-trip compat (cmux.json unknown keys survive save → load).
  const cfg = {
    ...otherFields,
    ...(agentDetection !== undefined ? { agentDetection } : {}),
    ...(agents !== undefined ? { agents } : {}),
  } as GnarTermConfig;

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

  // Try per-project config first (higher priority), then global. Each
  // entry is `{ read, writeForward? }`: `read` is the file we try to
  // load; `writeForward` (if set) is the canonical path to redirect
  // _configPath to so the next saveConfig writes the new filename and
  // orphans the old one. Entries without `writeForward` are canonical —
  // the next save writes back to the same file.
  //
  // settings.json is intentionally absent from this list — it is no
  // longer read or written at any path.
  const candidates: { read: string; writeForward?: string }[] = [
    { read: "gnar-term.json" },
    { read: ".gnar-term", writeForward: "gnar-term.json" },
    { read: "cmux.json", writeForward: "gnar-term.json" },
    { read: `${configDir}/gnar-term.json` },
    {
      read: `${configDir}/cmux.json`,
      writeForward: `${configDir}/gnar-term.json`,
    },
    {
      read: `${home}/.config/cmux/cmux.json`,
      writeForward: `${configDir}/gnar-term.json`,
    },
  ];

  for (const { read, writeForward } of candidates) {
    // Read and parse are split so JSON.parse failures (file present but
    // corrupt) surface loudly instead of being conflated with ENOENT-like
    // read errors. A corrupt canonical file aborts the cascade so we don't
    // silently load a lower-priority legacy source and then overwrite the
    // corrupt file with stale data on the next saveConfig.
    let content: string;
    try {
      content = await invoke<string>("read_file", { path: read });
    } catch {
      continue;
    }
    try {
      _config = migrateLoadedConfig(JSON.parse(content));
    } catch (err) {
      console.warn(
        `[config] Failed to parse ${read}; aborting migration cascade so the corrupt file is not overwritten on save.`,
        err,
      );
      _config = {};
      _configPath = "";
      _configStore.set(_config);
      return _config;
    }
    _configPath = writeForward ?? read;
    _configStore.set(_config);
    return _config;
  }

  // No config found — use defaults
  _config = {};
  _configPath = `${configDir}/gnar-term.json`;
  _configStore.set(_config);
  return _config;
}

export async function saveConfig(
  updates: Partial<GnarTermConfig>,
): Promise<void> {
  _config = { ..._config, ...updates };
  _configStore.set(_config);
  const configDir = await getConfigDir();
  const path = _configPath || `${configDir}/gnar-term.json`;

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

/**
 * Set when loadState detects state.json exists but is unparseable. When true,
 * saveState refuses to overwrite the file so the user's last good session
 * isn't silently wiped on the next quit. Cleared by resetConfigStateForTests
 * and on the next successful loadState.
 */
let _stateLoadCorrupt = false;

/** For tests only — resets all module-level config and state so tests don't bleed into each other. */
export function resetConfigStateForTests(): void {
  _config = {};
  _configPath = "";
  _configStore.set({});
  _appState = {};
  _appStateStore.set({});
  _stateLoadCorrupt = false;
}

export async function loadState(): Promise<AppState> {
  const configDir = await getConfigDir();
  const path = `${configDir}/state.json`;
  // Split read from parse so a corrupt state.json surfaces loudly instead
  // of looking like "no state file" — the latter triggers auto-default
  // Terminal which would then overwrite the user's persisted session on
  // the next saveState.
  _stateLoadCorrupt = false;
  let content: string;
  try {
    content = await invoke<string>("read_file", { path });
  } catch {
    _appState = {};
    _appStateStore.set(_appState);
    return _appState;
  }
  try {
    _appState = JSON.parse(content) as AppState;
  } catch (err) {
    _stateLoadCorrupt = true;
    console.warn(
      `[state] Failed to parse ${path}; refusing to overwrite until it is repaired. Falling back to empty state for this session.`,
      err,
    );
    _appState = {};
  }

  _appStateStore.set(_appState);
  return _appState;
}

export async function saveState(updates: Partial<AppState>): Promise<void> {
  _appState = { ..._appState, ...updates };
  _appStateStore.set(_appState);
  if (_stateLoadCorrupt) {
    // state.json exists on disk but couldn't be parsed at load time —
    // refuse to overwrite so the user can recover their previous session.
    console.warn(
      "[state] Skipping save: state.json was unparseable at load. Repair or move the file to re-enable persistence.",
    );
    return;
  }
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
