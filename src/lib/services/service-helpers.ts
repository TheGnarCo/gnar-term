import { tick } from "svelte";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { activeSurface, workspaces } from "../stores/workspace";
import {
  getAllPanes,
  getAllSurfaces,
  isTerminalSurface,
  type Surface,
  type TerminalSurface,
} from "../types";

// Cached home directory — resolved once, reused everywhere
let _home = "";
export async function getHome(): Promise<string> {
  if (_home) return _home;
  try {
    _home = await invoke<string>("get_home");
  } catch {
    _home = "/tmp";
  }
  return _home;
}

// Cached global config directory — gnar-term in release, gnar-term-dev in debug
let _configDir = "";
export async function getConfigDir(): Promise<string> {
  if (_configDir) return _configDir;
  try {
    _configDir = await invoke<string>("get_global_config_dir");
  } catch {
    const home = await getHome();
    _configDir = `${home}/.config/gnar-term`;
  }
  return _configDir;
}

/** For tests only — resets the module-level config dir cache. */
export function resetConfigDirForTests(): void {
  _configDir = "";
}

// Single source of truth for "is this a debug/dev build" — backed by
// cfg!(debug_assertions) in Rust, which is true for both `tauri dev` and
// `tauri build --debug`, and false for `tauri build` (release).
let _isDebugBuild: boolean | undefined;
export async function isDebugBuild(): Promise<boolean> {
  if (_isDebugBuild !== undefined) return _isDebugBuild;
  try {
    _isDebugBuild = (await invoke<boolean>("is_debug_build")) === true;
  } catch {
    _isDebugBuild = false;
  }
  return _isDebugBuild;
}

/** For tests only — resets the module-level debug build cache. */
export function resetIsDebugBuildForTests(): void {
  _isDebugBuild = undefined;
}

export function forEachTerminalSurface(fn: (s: TerminalSurface) => void): void {
  for (const ws of get(workspaces)) {
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s)) fn(s);
    }
  }
}

export async function safeFocus(s: Surface | null | undefined) {
  if (!s || !isTerminalSurface(s)) return;
  await tick();
  s.terminal.focus();
}

export async function getCwdForSurface(
  surface: Surface | null | undefined,
): Promise<string | undefined> {
  if (!surface || !isTerminalSurface(surface)) return undefined;
  if (surface.cwd) return surface.cwd;
  if (surface.ptyId >= 0) {
    try {
      return (
        (await invoke<string>("get_pty_cwd", { ptyId: surface.ptyId })) ||
        undefined
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function getActiveCwd(): Promise<string | undefined> {
  return getCwdForSurface(get(activeSurface));
}

// Like getActiveCwd but targets any workspace by ID, not just the active one.
export async function getWorkspaceCwd(
  workspaceId: string,
): Promise<string | undefined> {
  const ws = get(workspaces).find((w) => w.id === workspaceId);
  if (!ws) return undefined;
  for (const pane of getAllPanes(ws.splitRoot)) {
    for (const s of pane.surfaces) {
      const cwd = await getCwdForSurface(s);
      if (cwd) return cwd;
    }
  }
  return undefined;
}
