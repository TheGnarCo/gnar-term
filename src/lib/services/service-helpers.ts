import { tick } from "svelte";
import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { activeSurface } from "../stores/workspace";
import { isTerminalSurface, type Surface } from "../types";

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
      return await invoke<string>("get_pty_cwd", { ptyId: surface.ptyId }) || undefined;
    } catch { return undefined; }
  }
  return undefined;
}
