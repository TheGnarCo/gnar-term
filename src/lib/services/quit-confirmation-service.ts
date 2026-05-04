/**
 * Quit-confirmation gate.
 *
 * `App.svelte`'s `onCloseRequested` previously fired `ask("Quit GnarTerm?")`
 * unconditionally — even when no terminals were live. This service counts
 * the live terminal surfaces and skips the dialog entirely when nothing
 * is at stake; otherwise it surfaces a count so the user knows how many
 * PTYs the quit will tear down.
 */
import { get } from "svelte/store";
import { ask } from "@tauri-apps/plugin-dialog";
import { nestedWorkspaces } from "../stores/nested-workspace";
import { getAllSurfaces, isTerminalSurface } from "../types";
import { writeSessionLogsForAllSurfaces } from "./session-log-service";

/**
 * Count live terminal surfaces across every nested workspace. A terminal
 * is considered live once its backing PTY id is non-negative — surfaces
 * still spawning (ptyId === -1) don't count toward the prompt.
 */
export function countLiveTerminals(): number {
  return get(nestedWorkspaces)
    .flatMap(getAllSurfaces)
    .filter(isTerminalSurface)
    .filter((s) => s.ptyId >= 0).length;
}

/**
 * Resolve to true when the quit should proceed, false when the user
 * cancelled. When zero terminals are live the dialog is skipped and the
 * function resolves to true immediately. Any error from the dialog API
 * resolves to false so a failed prompt cannot silently destroy work.
 */
export async function confirmQuit(): Promise<boolean> {
  const liveCount = countLiveTerminals();
  let confirmed: boolean;
  if (liveCount === 0) {
    confirmed = true;
  } else {
    try {
      confirmed = await ask(
        `Quit GnarTerm? ${liveCount} terminal${liveCount === 1 ? "" : "s"} will be closed.`,
        { title: "Quit", kind: "warning" },
      );
    } catch {
      return false;
    }
  }
  if (!confirmed) return false;
  // Write session logs for all open terminals before returning so buffers
  // are still readable (terminals haven't been disposed yet). Best-effort:
  // a failure here must never block the quit.
  try {
    await writeSessionLogsForAllSurfaces();
  } catch (e) {
    console.warn("[shutdown] session log flush failed:", e);
  }
  return true;
}
