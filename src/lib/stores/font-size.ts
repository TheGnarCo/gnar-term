/**
 * Font size for terminal surfaces. Single writable store; App.svelte
 * subscribes and propagates changes to every open TerminalSurface +
 * calls fit() + persists to config.fontSize.
 *
 * The store holds an absolute pixel size, not a zoom level, so config
 * round-trips as a simple number.
 */
import { writable } from "svelte/store";

export const DEFAULT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
const STEP = 1;

export const fontSize = writable<number>(DEFAULT_FONT_SIZE);

export function zoomIn(): void {
  fontSize.update((n) => Math.min(MAX_FONT_SIZE, n + STEP));
}

export function zoomOut(): void {
  fontSize.update((n) => Math.max(MIN_FONT_SIZE, n - STEP));
}

export function resetFontSize(): void {
  fontSize.set(DEFAULT_FONT_SIZE);
}

export function setFontSizeFromConfig(n: number | undefined): void {
  if (typeof n !== "number" || Number.isNaN(n)) return;
  const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n));
  fontSize.set(clamped);
}
