import { tick } from "svelte";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { activeSurface, workspaces } from "../stores/workspace";
import {
  getAllPanes,
  getAllSurfaces,
  isPreviewSurface,
  isTerminalSurface,
  type Surface,
  type TerminalSurface,
} from "../types";

// Cached home directory — resolved once, reused everywhere.
// Only the successful resolution is cached. A transient Tauri failure falls back
// to "/tmp" but does NOT cache it, so the next call retries the invoke.
let _home = "";
export async function getHome(): Promise<string> {
  if (_home) return _home;
  try {
    _home = await invoke<string>("get_home");
  } catch (err) {
    console.warn(
      "[getHome] Tauri get_home invoke failed; falling back to /tmp. Next call will retry.",
      err,
    );
    return "/tmp";
  }
  return _home;
}

/** For tests only — resets the module-level home cache. */
export function resetHomeForTests(): void {
  _home = "";
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

// --- Surface/PTY lookup index ---
// Rebuilt on every workspaces store update so hot-path callers get O(1) lookups
// instead of O(W×S) nested scans. Only valid outside of workspaces.update()
// callbacks — reads from the index during an update see the pre-update state.

const _ptyIndex = new Map<number, TerminalSurface>(); // ptyId → terminal surface
const _surfaceWsIndex = new Map<string, string>(); // surfaceId → workspaceId
const _surfacePtyIndex = new Map<string, number>(); // surfaceId → ptyId

// Deferred subscription: avoid subscribing at module load time to prevent
// circular-initialization issues (workspace.ts → config.ts → service-helpers.ts
// → workspace.ts). The subscription is established on first use of any
// lookup function, or explicitly via initSurfaceIndex().
let _indexSubscribed = false;
function ensureIndexSubscribed(): void {
  if (_indexSubscribed) return;
  _indexSubscribed = true;
  workspaces.subscribe(($ws) => {
    _ptyIndex.clear();
    _surfaceWsIndex.clear();
    _surfacePtyIndex.clear();
    for (const ws of $ws) {
      if (!ws?.paneLayout) continue;
      for (const pane of getAllPanes(ws.paneLayout)) {
        for (const surface of pane.surfaces) {
          _surfaceWsIndex.set(surface.id, ws.id);
          if (isTerminalSurface(surface)) {
            if (surface.ptyId >= 0) _ptyIndex.set(surface.ptyId, surface);
            _surfacePtyIndex.set(surface.id, surface.ptyId);
          }
        }
      }
    }
  });
}

/** Call once at app startup (after stores are initialized) to begin tracking. */
export function initSurfaceIndex(): void {
  ensureIndexSubscribed();
}

export function lookupTerminalByPtyId(
  ptyId: number,
): TerminalSurface | undefined {
  ensureIndexSubscribed();
  return _ptyIndex.get(ptyId);
}

export function lookupSurfaceWorkspaceId(
  surfaceId: string,
): string | undefined {
  ensureIndexSubscribed();
  return _surfaceWsIndex.get(surfaceId);
}

export function lookupPtyIdForSurface(surfaceId: string): number | undefined {
  ensureIndexSubscribed();
  return _surfacePtyIndex.get(surfaceId);
}

// Called immediately after connectPty assigns a real ptyId so the index
// reflects the new id without waiting for a workspaces store emission.
export function registerPtyForSurface(
  ptyId: number,
  surface: TerminalSurface,
): void {
  _ptyIndex.set(ptyId, surface);
  _surfacePtyIndex.set(surface.id, ptyId);
}

export async function safeFocus(s: Surface | null | undefined) {
  if (!s || !isTerminalSurface(s)) return;
  await tick();
  s.terminal.focus();
}

export async function getCwdForSurface(
  surface: Surface | null | undefined,
): Promise<string | undefined> {
  if (!surface) return undefined;
  if (isPreviewSurface(surface)) {
    const lastSlash = surface.path.lastIndexOf("/");
    return lastSlash > 0 ? surface.path.slice(0, lastSlash) : "/";
  }
  if (!isTerminalSurface(surface)) return undefined;
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
  for (const pane of getAllPanes(ws.paneLayout)) {
    for (const s of pane.surfaces) {
      const cwd = await getCwdForSurface(s);
      if (cwd) return cwd;
    }
  }
  return undefined;
}
