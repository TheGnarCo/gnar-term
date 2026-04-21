import { tick } from "svelte";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { activeSurface, workspaces } from "../stores/workspace";
import { getAllPanes, isTerminalSurface, type Surface } from "../types";

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

export async function safeFocus(s: Surface | null | undefined) {
  if (!s || !isTerminalSurface(s)) return;
  await tick();
  s.terminal.focus();
}

export async function getActiveCwd(): Promise<string | undefined> {
  const surface = get(activeSurface);
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

/**
 * Resolve a specific workspace's cwd from its first terminal surface,
 * without requiring the workspace to be active. Used by services that
 * want to track every workspace (e.g. git-status polling) rather than
 * only the active one.
 */
export async function getWorkspaceCwd(
  workspaceId: string,
): Promise<string | undefined> {
  const ws = get(workspaces).find((w) => w.id === workspaceId);
  if (!ws) return undefined;
  for (const pane of getAllPanes(ws.splitRoot)) {
    for (const s of pane.surfaces) {
      if (!isTerminalSurface(s)) continue;
      if (s.cwd) return s.cwd;
      if (s.ptyId >= 0) {
        try {
          const live = await invoke<string>("get_pty_cwd", { ptyId: s.ptyId });
          if (live) return live;
        } catch {
          /* fall through */
        }
      }
    }
  }
  return undefined;
}
