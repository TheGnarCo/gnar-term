/**
 * Terminal Focus — shared focus utility for terminal surfaces.
 *
 * Uses Svelte's tick() to ensure the DOM has reconciled before
 * focusing, avoiding race conditions with requestAnimationFrame.
 */

import { tick } from "svelte";
import type { Surface } from "./types";
import { isTerminalSurface, isHarnessSurface } from "./types";

/** Focus a terminal or harness surface after the DOM has settled. */
export async function safeFocusTerminal(
  s: Surface | null | undefined,
): Promise<void> {
  if (!s) return;
  if (!isTerminalSurface(s) && !isHarnessSurface(s)) return;
  await tick();
  s.terminal.focus();
}
