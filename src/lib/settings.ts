/**
 * GnarTerm Settings System
 *
 * User preferences live in ~/.config/gnar/settings.json (hand-editable).
 * Per-project overrides live in <project-root>/.gnar/settings.json.
 * Harnesses merge by id: project presets add/override global ones, not replace.
 */

import { invoke } from "@tauri-apps/api/core";
import type { HarnessPreset } from "./types";
import { getHome, _resetHomeForTesting as _resetHome } from "./tauri-helpers";

// --- Types ---

export interface KeybindingSettings {
  home: string;
  newWorktree: string;
  toggleRightSidebar: string;
  stashWorkspace: string;
}

export interface StatusDetectionSettings {
  oscNotifications: boolean;
  titleParsing: boolean;
  processMonitoring: boolean;
  idleThresholdMs: number;
}

export interface CommandDef {
  name: string;
  command?: string;
  keybinding?: string;
  confirm?: boolean;
  description?: string;
  keywords?: string[];
  restart?: "ignore" | "recreate" | "confirm";
  workspace?: WorkspaceDef;
}

// --- Workspace layout types (used by workspace serialization) ---

export interface SurfaceDef {
  type?: "terminal" | "browser" | "markdown" | "harness";
  name?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  path?: string;
  focus?: boolean;
  presetId?: string;
}

export interface PaneDef {
  surfaces: SurfaceDef[];
}

export interface SplitDef {
  direction: "horizontal" | "vertical";
  split?: number;
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = { pane: PaneDef } | SplitDef;

export interface WorkspaceDef {
  name?: string;
  cwd?: string;
  color?: string;
  layout?: LayoutNode;
}

export interface Settings {
  theme: string;
  fontSize: number;
  fontFamily: string;
  opacity: number;
  autoload: string[];
  projectsDir: string;
  worktreePrefix: string;
  worktreeBaseDir: string;
  harnesses: HarnessPreset[];
  defaultHarness: string;
  keybindings: KeybindingSettings;
  commands: CommandDef[];
  statusDetection: StatusDetectionSettings;
  /** Glob patterns of files to copy from main worktree into new worktrees. */
  copyFiles: string[];
  /** Shell command to run after creating a new worktree (e.g. "bun install"). */
  setup: string;
}

// Subset of Settings that project-level .gnar/settings.json can override
export interface ProjectSettingsOverride {
  worktreePrefix?: string;
  defaultHarness?: string;
  harnesses?: HarnessPreset[];
  /** Preset IDs to auto-spawn when creating a managed workspace. Falls back to [defaultHarness]. */
  autoSpawnHarnesses?: string[];
  /** Glob patterns of files to copy from main worktree into new worktrees. */
  copyFiles?: string[];
  /** Shell command to run after creating a new worktree (e.g. "bun install"). */
  setup?: string;
}

// --- Defaults ---

export const DEFAULT_SETTINGS: Settings = {
  theme: "tokyo-night",
  fontSize: 14,
  fontFamily: "MesloLGS Nerd Font",
  opacity: 1.0,
  autoload: [],
  projectsDir: "~/Projects",
  worktreePrefix: "gnar/",
  worktreeBaseDir: "nested",
  harnesses: [
    {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      args: [],
      env: {},
      icon: "claude",
    },
  ],
  defaultHarness: "claude",
  keybindings: {
    home: "cmd+shift+h",
    newWorktree: "cmd+shift+n",
    toggleRightSidebar: "cmd+shift+e",
    stashWorkspace: "cmd+shift+s",
  },
  commands: [],
  copyFiles: [],
  setup: "",
  statusDetection: {
    oscNotifications: true,
    titleParsing: true,
    processMonitoring: true,
    idleThresholdMs: 5000,
  },
};

// --- Harness merge ---

export function mergeHarnessPresets(
  base: HarnessPreset[],
  overrides: HarnessPreset[],
): HarnessPreset[] {
  const merged = new Map<string, HarnessPreset>();
  for (const h of base) merged.set(h.id, { ...h });
  for (const h of overrides) {
    const existing = merged.get(h.id);
    merged.set(h.id, existing ? { ...existing, ...h } : { ...h });
  }
  return Array.from(merged.values());
}

// --- Internal state ---

let _settings: Settings = { ...DEFAULT_SETTINGS };

function settingsPath(home: string): string {
  return `${home}/.config/gnar/settings.json`;
}

function mergeWithDefaults(partial: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    keybindings: { ...DEFAULT_SETTINGS.keybindings, ...partial.keybindings },
    statusDetection: {
      ...DEFAULT_SETTINGS.statusDetection,
      ...partial.statusDetection,
    },
    harnesses: partial.harnesses
      ? mergeHarnessPresets(DEFAULT_SETTINGS.harnesses, partial.harnesses)
      : [...DEFAULT_SETTINGS.harnesses],
  };
}

// --- Public API ---

export async function loadSettings(): Promise<Settings> {
  const home = await getHome();
  const path = settingsPath(home);

  try {
    const content = await invoke<string>("read_file", { path });
    const parsed = JSON.parse(content);
    _settings = mergeWithDefaults(parsed);
    return _settings;
  } catch {
    // No settings file yet — use defaults
  }

  _settings = {
    ...DEFAULT_SETTINGS,
    harnesses: [...DEFAULT_SETTINGS.harnesses],
  };
  return _settings;
}

export async function loadProjectSettings(
  projectPath: string,
  base: Settings,
): Promise<Settings> {
  const path = `${projectPath}/.gnar/settings.json`;

  try {
    const content = await invoke<string>("read_file", { path });
    const overrides: ProjectSettingsOverride = JSON.parse(content);

    return {
      ...base,
      ...(overrides.worktreePrefix !== undefined && {
        worktreePrefix: overrides.worktreePrefix,
      }),
      ...(overrides.defaultHarness !== undefined && {
        defaultHarness: overrides.defaultHarness,
      }),
      ...(overrides.copyFiles !== undefined && {
        copyFiles: overrides.copyFiles,
      }),
      ...(overrides.setup !== undefined && {
        setup: overrides.setup,
      }),
      harnesses: overrides.harnesses
        ? mergeHarnessPresets(base.harnesses, overrides.harnesses)
        : base.harnesses,
    };
  } catch {
    return base;
  }
}

export function getSettings(): Settings {
  return _settings;
}

export async function saveSettings(updates: Partial<Settings>): Promise<void> {
  const next: Settings = {
    ..._settings,
    ...updates,
    keybindings: { ..._settings.keybindings, ...updates.keybindings },
    statusDetection: {
      ..._settings.statusDetection,
      ...updates.statusDetection,
    },
    harnesses: updates.harnesses
      ? mergeHarnessPresets(_settings.harnesses, updates.harnesses)
      : _settings.harnesses,
  };

  const home = await getHome();

  try {
    await invoke("ensure_dir", { path: `${home}/.config/gnar` });
  } catch {}

  await invoke("write_file", {
    path: settingsPath(home),
    content: JSON.stringify(next, null, 2),
  });

  _settings = next;
}

/** Get all commands that define a workspace layout */
export function getWorkspaceCommands(): CommandDef[] {
  return (_settings.commands || []).filter((c) => c.workspace);
}

/** Read autoSpawnHarnesses from a project's .gnar/settings.json. Returns undefined if not set. */
export async function getProjectAutoSpawnHarnesses(
  projectPath: string,
): Promise<string[] | undefined> {
  try {
    const content = await invoke<string>("read_file", {
      path: `${projectPath}/.gnar/settings.json`,
    });
    const overrides: ProjectSettingsOverride = JSON.parse(content);
    return overrides.autoSpawnHarnesses;
  } catch {
    return undefined;
  }
}

/** Reset module state — for tests only */
export function _resetForTesting(): void {
  _settings = {
    ...DEFAULT_SETTINGS,
    harnesses: [...DEFAULT_SETTINGS.harnesses],
  };
  _resetHome();
}
