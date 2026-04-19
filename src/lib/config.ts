/**
 * GnarTerm Config — settings and runtime state
 *
 * Settings file locations (in priority order):
 *   ./settings.json                     (per-project)
 *   ~/.config/gnar-term/settings.json   (global)
 *   ./gnar-term.json                    (legacy per-project)
 *   ./cmux.json                         (per-project, cmux compat)
 *   ~/.config/cmux/cmux.json            (global, cmux compat)
 *
 * Runtime state:
 *   ~/.config/gnar-term/state.json      (written on quit, restored on launch)
 */

import { invoke } from "@tauri-apps/api/core";
import { writable, type Readable } from "svelte/store";
import { getHome } from "./services/service-helpers";

// --- Types (cmux-compatible + extensions) ---

export interface SurfaceDef {
  type?: "terminal" | "browser" | "markdown" | "extension";
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  url?: string; // browser only
  path?: string; // markdown (legacy, maps to extension type "preview:preview")
  extensionType?: string; // e.g. "preview:preview" — maps to surfaceTypeId
  extensionProps?: Record<string, unknown>; // arbitrary props for the extension surface
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
  name?: string;
  cwd?: string;
  color?: string;
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
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

export interface GnarTermConfig {
  // gnar-term extensions
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  opacity?: number;
  autoload?: string[]; // workspace command names to launch on startup
  extensions?: Record<string, ExtensionConfig>;
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

export interface AppState {
  sidebarWidths?: { primary?: number; secondary?: number };
  sidebarVisible?: { primary?: boolean; secondary?: boolean };
  windowBounds?: { x?: number; y?: number; width?: number; height?: number };
  workspaces?: (WorkspaceDef & { name: string })[];
  activeWorkspaceIdx?: number;
  // Interleaved ordering for the Workspaces section: unclaimed
  // workspaces and whole project blocks sit in a single list the user
  // can drag across freely. See stores/root-row-order.ts.
  rootRowOrder?: { kind: string; id: string }[];
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
      _config = JSON.parse(content);
      _configPath = explicitPath;
      _configStore.set(_config);
      return _config;
    } catch (e) {
      console.warn(`[config] Failed to load ${explicitPath}:`, e);
    }
  }

  const home = await getHome();

  // Try per-project config first (higher priority), then global
  const paths = [
    ...CONFIG_FILENAMES, // ./gnar-term.json, ./cmux.json
    `${home}/.config/gnar-term/settings.json`,
    `${home}/.config/cmux/cmux.json`,
  ];

  for (const path of paths) {
    try {
      const content = await invoke<string>("read_file", { path });
      _config = JSON.parse(content);
      _configPath = path;
      _configStore.set(_config);
      return _config;
    } catch {}
  }

  // No config found — use defaults
  _config = {};
  _configPath = `${home}/.config/gnar-term/settings.json`;
  _configStore.set(_config);
  return _config;
}

export async function saveConfig(
  updates: Partial<GnarTermConfig>,
): Promise<void> {
  _config = { ..._config, ...updates };
  _configStore.set(_config);
  const home = await getHome();
  const path = _configPath || `${home}/.config/gnar-term/settings.json`;

  // Ensure directory exists
  try {
    await invoke("ensure_dir", { path: `${home}/.config/gnar-term` });
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
  const home = await getHome();
  const path = `${home}/.config/gnar-term/state.json`;
  try {
    const content = await invoke<string>("read_file", { path });
    _appState = JSON.parse(content);
  } catch {
    _appState = {};
  }
  _appStateStore.set(_appState);
  return _appState;
}

export async function saveState(updates: Partial<AppState>): Promise<void> {
  _appState = { ..._appState, ...updates };
  _appStateStore.set(_appState);
  const home = await getHome();
  const path = `${home}/.config/gnar-term/state.json`;
  try {
    await invoke("ensure_dir", { path: `${home}/.config/gnar-term` });
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
