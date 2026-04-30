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
import { runConfigMigrations } from "./services/config-migrations";
import type { WorkspaceMetadata } from "./types";
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

export interface WorkspaceDef {
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

export interface CommandDef {
  name: string;
  description?: string;
  keywords?: string[];
  command?: string; // simple shell command
  confirm?: boolean;
  restart?: "ignore" | "recreate" | "confirm";
  workspace?: WorkspaceDef; // workspace command
}

export interface ExtensionConfig {
  enabled: boolean;
  source?: string; // e.g. "github:TheGnarCo/gnar-term-ext-github-issues"
  settings?: Record<string, unknown>; // extension-specific settings values
}

export type McpSetting = "auto" | "on" | "off";

export interface WorktreeWorkspaceEntry {
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
  entries?: WorktreeWorkspaceEntry[];
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
 * Workspace Group — a named, colored, path-rooted grouping of
 * workspaces. Workspaces whose CWD falls under `path` are auto-adopted
 * (via `metadata.groupId`) and render nested inside the group's block
 * in the Workspaces section.
 *
 * Defined in core (rather than in an extension) because it is persisted
 * user data that multiple core services and extensions read. Stage 5
 * relocates the backing CRUD service from the old extension to core; the
 * type already lives here so dashboard-contribution consumers can depend
 * on a stable core import path.
 */
export interface WorkspaceGroupEntry {
  id: string;
  name: string;
  /** Root CWD — auto-adoption uses this as a longest-prefix ancestor match. */
  path: string;
  color: string;
  /** Ids of workspaces currently claimed by this group. */
  workspaceIds: string[];
  /** True when `path` is the root of a git repo. Used by gates (e.g. worktree actions). */
  isGit: boolean;
  createdAt: string;
  /**
   * Id of the Group Dashboard workspace hosting this group's markdown
   * Live Preview. Eagerly created alongside the group. Resolved from
   * the workspaces store by consumers.
   */
  dashboardWorkspaceId?: string;
  /** When true, the group cannot be drag-reordered or deleted/archived. */
  locked?: boolean;
}

export interface GnarTermConfig {
  /**
   * Monotonic schema version for on-disk config shape. Loaders call
   * `runConfigMigrations` (src/lib/services/config-migrations.ts) after
   * parsing; migrations advance this to the current target and the
   * loader saves back when it changes.
   *
   * Absent on configs written before the migration scaffold landed —
   * those are treated as version 0 and stamped on first load.
   */
  schemaVersion?: number;
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
   * Global Agentic Dashboard configuration — the singleton
   * pseudo-workspace pinned at the top of the root sidebar. `markdownPath`
   * points at the backing markdown file the dashboard renders. Absent on
   * fresh installs; the pseudo-workspace falls back to the default
   * `~/.config/gnar-term/global-agents.md` path. Stage 8 migration stamps
   * this field when converting a legacy rootless orchestrator.
   */
  agenticGlobal?: {
    markdownPath?: string;
  };
  /**
   * Per-pseudo-workspace color overrides, keyed by pseudo id
   * (e.g. `"agentic.global"`). Values are slot names from
   * `GROUP_COLOR_SLOTS` (same palette Workspace Groups use) or any
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
  workspaces?: (WorkspaceDef & { name: string })[];
  activeWorkspaceIdx?: number;
  // Interleaved ordering for the Workspaces section: unclaimed
  // workspaces and workspace group blocks sit in a single list the user
  // can drag across freely. See stores/root-row-order.ts.
  rootRowOrder?: { kind: string; id: string }[];
  // Archived (suspended) workspaces and groups. See stores/archive.ts.
  archivedOrder?: { kind: string; id: string }[];
  archivedDefs?: {
    workspaces: Record<string, { def: WorkspaceDef & { name: string } }>;
    groups: Record<
      string,
      {
        group: WorkspaceGroupEntry;
        workspaceDefs: (WorkspaceDef & { name: string })[];
      }
    >;
  };
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

async function applyMigrationsAndPersist(
  parsed: GnarTermConfig,
  path: string,
): Promise<GnarTermConfig> {
  const { migrated, changed } = await runConfigMigrations(parsed);
  if (!changed) return migrated;
  try {
    await invoke("write_file", {
      path,
      content: JSON.stringify(migrated, null, 2),
    });
  } catch (err) {
    // Migration is in-memory-correct; disk persistence is best-effort.
    // Next successful saveConfig will flush the new shape.
    console.warn("[config] Failed to persist migrated config:", err);
  }
  return migrated;
}

export async function loadConfig(
  explicitPath?: string,
): Promise<GnarTermConfig> {
  // If an explicit config path was provided (e.g. via --config), try it first
  if (explicitPath) {
    try {
      const content = await invoke<string>("read_file", { path: explicitPath });
      const parsed = JSON.parse(content) as GnarTermConfig;
      _config = await applyMigrationsAndPersist(parsed, explicitPath);
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
      const parsed = JSON.parse(content) as GnarTermConfig;
      _config = await applyMigrationsAndPersist(parsed, path);
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

/**
 * Rewrite legacy workspace-scoped state shapes to the new Workspace
 * Groups + Dashboard Contributions layout:
 *   - workspaces[].metadata.projectId → metadata.groupId
 *   - workspaces[].metadata.parentOrchestratorId → metadata.spawnedBy
 *   - workspaces[].metadata.orchestratorId (on dashboards) →
 *       metadata.dashboardContributionId = "agentic"
 *   - rootRowOrder[].kind === "project" → "workspace-group"
 *   - rootRowOrder[].kind === "agent-orchestrator" → dropped (Stage 7
 *     removed the orchestrator root-row)
 *
 * Runs on every load — idempotent when the shape is already migrated.
 * Paired with the v1/v2 migrations in config-migrations.ts; both land
 * in the same release so old state on disk reads as the new shape in
 * memory without requiring an explicit schemaVersion lookup.
 */
export function migrateLegacyProjectShapes(state: AppState): {
  migrated: AppState;
  changed: boolean;
} {
  let changed = false;
  let next: AppState = state;

  if (Array.isArray(state.workspaces)) {
    let workspacesChanged = false;
    const workspaces = state.workspaces.map((ws) => {
      // Migration reads persisted state which may carry legacy keys not in
      // WorkspaceMetadata (parentOrchestratorId, orchestratorId, spawnedBy).
      // Cast to a wider type so we can inspect and drop them.
      const md = ws.metadata as
        | (WorkspaceMetadata & Record<string, unknown>)
        | undefined;
      if (!md) return ws;

      const needsProjectIdRewrite = "projectId" in md;
      const needsSpawnedBy =
        typeof md.parentOrchestratorId === "string" && !("spawnedBy" in md);
      const needsLegacyDrop =
        "parentOrchestratorId" in md || "orchestratorId" in md;
      const needsContributionId =
        md.isDashboard === true &&
        typeof md.orchestratorId === "string" &&
        !("dashboardContributionId" in md);

      if (
        !needsProjectIdRewrite &&
        !needsSpawnedBy &&
        !needsContributionId &&
        !needsLegacyDrop
      ) {
        return ws;
      }

      const { projectId, parentOrchestratorId, orchestratorId, ...rest } =
        md as Record<string, unknown> & {
          projectId?: unknown;
          parentOrchestratorId?: unknown;
          orchestratorId?: unknown;
        };
      const nextMd: Record<string, unknown> = { ...rest };

      if (needsProjectIdRewrite) {
        if (
          nextMd.groupId === undefined &&
          projectId !== undefined &&
          projectId !== null
        ) {
          nextMd.groupId = projectId;
        }
      }

      if (needsSpawnedBy) {
        const groupId =
          typeof nextMd.groupId === "string" ? nextMd.groupId : undefined;
        nextMd.spawnedBy = groupId
          ? { kind: "group", groupId }
          : { kind: "global" };
      } else if (parentOrchestratorId !== undefined) {
        // parentOrchestratorId present but spawnedBy already set — drop the
        // legacy marker without synthesizing a replacement.
      }

      if (needsContributionId) {
        nextMd.dashboardContributionId = "agentic";
      } else if (orchestratorId !== undefined && md.isDashboard !== true) {
        // Preserve stray orchestratorId on non-dashboard workspaces only if
        // the caller didn't otherwise trigger a rewrite path — but since we
        // decompose `md` above, drop it.
      }

      workspacesChanged = true;
      return { ...ws, metadata: nextMd };
    });
    if (workspacesChanged) {
      changed = true;
      next = { ...next, workspaces };
    }
  }

  if (Array.isArray(state.rootRowOrder)) {
    let orderChanged = false;
    const rootRowOrder: typeof state.rootRowOrder = [];
    for (const row of state.rootRowOrder) {
      if (row.kind === "agent-orchestrator") {
        orderChanged = true;
        continue;
      }
      if (row.kind === "project") {
        orderChanged = true;
        rootRowOrder.push({ ...row, kind: "workspace-group" });
        continue;
      }
      rootRowOrder.push(row);
    }
    if (orderChanged) {
      changed = true;
      next = { ...next, rootRowOrder };
    }
  }

  return { migrated: next, changed };
}

export async function loadState(): Promise<AppState> {
  const configDir = await getConfigDir();
  const path = `${configDir}/state.json`;
  try {
    const content = await invoke<string>("read_file", { path });
    const parsed = JSON.parse(content) as AppState;
    const { migrated, changed } = migrateLegacyProjectShapes(parsed);
    _appState = migrated;
    if (changed) {
      try {
        await invoke("write_file", {
          path,
          content: JSON.stringify(migrated, null, 2),
        });
      } catch (err) {
        console.warn("[state] Failed to persist migrated state:", err);
      }
    }
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
