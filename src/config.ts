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
  name?: string;
  cwd?: string;
  color?: string;
  layout?: LayoutNode;
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

export interface GnarTermConfig {
  // gnar-term extensions
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  opacity?: number;
  autoload?: string[];  // workspace command names to launch on startup
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

export async function loadConfig(): Promise<GnarTermConfig> {
  // Try global config locations
  const home = await getHome();
  const paths = [
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

export function getWorkspaceCommands(): CommandDef[] {
  return getCommands().filter(c => c.workspace);
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
