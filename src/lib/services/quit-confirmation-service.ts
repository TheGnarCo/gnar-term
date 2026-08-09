/**
 * Quit-confirmation gate.
 *
 * The window's close-request handler previously let the app tear down every
 * live PTY silently. This service counts the live terminal surfaces and, when
 * any exist, surfaces an in-app confirmation so the user can cancel before
 * their running sessions are killed. With zero live terminals the quit
 * proceeds immediately with no prompt.
 */
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { getAllSurfaces, isTerminalSurface } from "../types";
import { showConfirmPrompt } from "../stores/ui";

/**
 * Count live terminal surfaces across every workspace. A terminal is
 * considered live once its backing PTY id is non-negative — surfaces still
 * spawning (ptyId === -1) don't count toward the prompt.
 */
export function countLiveTerminals(): number {
  return get(workspaces)
    .flatMap(getAllSurfaces)
    .filter(isTerminalSurface)
    .filter((s) => s.ptyId >= 0).length;
}

/**
 * Resolve to true when the quit should proceed, false when the user
 * cancelled. When zero terminals are live the dialog is skipped and the
 * function resolves to true immediately.
 */
export async function confirmQuit(): Promise<boolean> {
  const liveCount = countLiveTerminals();
  if (liveCount === 0) return true;
  return showConfirmPrompt(
    `${liveCount} terminal${liveCount === 1 ? "" : "s"} ${liveCount === 1 ? "is" : "are"} still running and will be closed.`,
    { title: "Quit GnarTerm?", confirmLabel: "Quit", cancelLabel: "Cancel" },
  );
}
