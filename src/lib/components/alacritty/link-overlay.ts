/**
 * link-overlay.ts — cycle-18, AC-3
 *
 * Attaches hover and click handlers to a terminal canvas for link detection.
 * When the user hovers over a URL or file path, `onDecorate` is called with
 * the matching `LinkMatch` (or `null` when leaving a link). When the user
 * modifier-clicks (Cmd on macOS, Ctrl on Linux) a link, the appropriate
 * Tauri command is invoked.
 *
 * Integration point for cycle-21:
 *   import { attachLinkOverlay, LinkOverlayHandle } from "./alacritty/link-overlay";
 *   const overlay = attachLinkOverlay(canvas, {
 *     cellWidth, cellHeight, getGrid,
 *     onDecorate: (match) => { // update cursor or underline decoration
 *     },
 *   });
 *   // On pane unmount:
 *   overlay.detach();
 *
 * Platform note: modifier-click uses metaKey (Cmd) on macOS and ctrlKey on
 * Linux, matching the existing `isMac` convention in terminal-service.ts.
 * We import isMac from terminal-service.ts as the single source of truth.
 * If the import path changes in cycle-21's cutover, update accordingly.
 */

import { invoke } from "@tauri-apps/api/core";
import { extractLinks } from "./link-extractor";
import type { GridSnapshot } from "../../types/terminal-ipc";
import type { LinkMatch } from "./link-extractor";

// ─── isMac detection ──────────────────────────────────────────────────────────

/**
 * Detect macOS at module load time (matches the isMac export in
 * terminal-service.ts so the overlay uses the same platform logic).
 *
 * This is a local constant rather than an import from terminal-service.ts to
 * keep the alacritty/ module free of the legacy terminal-service dependency.
 * cycle-21 may replace this with a direct import if terminal-service.ts is
 * restructured during the xterm cutover.
 */
const isMac =
  typeof navigator !== "undefined" &&
  (navigator.userAgent.includes("Mac") ||
    (navigator.platform?.toUpperCase().includes("MAC") ?? false));

// ─── LinkOverlayHandle ────────────────────────────────────────────────────────

/**
 * Handle returned by `attachLinkOverlay`.
 *
 * Call `detach()` on pane unmount to remove all event listeners and cancel
 * any pending debounce timer.
 */
export interface LinkOverlayHandle {
  /** Remove all listeners attached by `attachLinkOverlay`. */
  detach(): void;
}

// ─── LinkOverlayOptions ───────────────────────────────────────────────────────

/**
 * Options for `attachLinkOverlay`.
 */
export interface LinkOverlayOptions {
  /**
   * Cell width in pixels. Used to convert mouse pixel coordinates to
   * grid column indices.
   */
  cellWidth: number;

  /**
   * Cell height in pixels. Used to convert mouse pixel coordinates to
   * grid row indices.
   */
  cellHeight: number;

  /**
   * Returns the current `GridSnapshot`. Called on every hover event.
   * Keep this cheap — it is called on each debounced mousemove.
   */
  getGrid(): GridSnapshot | null;

  /**
   * Called when the hovered link changes. Receives the `LinkMatch` the
   * cursor is currently over, or `null` when the cursor has left all links.
   *
   * The renderer can use this to draw underlines or change the cursor
   * style. If omitted, hover decoration is a no-op.
   */
  onDecorate?: (match: LinkMatch | null) => void;
}

// ─── attachLinkOverlay ────────────────────────────────────────────────────────

/**
 * Attach link-hover and modifier-click handlers to `canvas`.
 *
 * @param canvas - The terminal canvas element to attach to.
 * @param opts - Configuration (cell dimensions, grid accessor, decoration
 *   callback).
 * @returns A `LinkOverlayHandle` that removes all listeners when `detach()`
 *   is called.
 */
export function attachLinkOverlay(
  canvas: HTMLCanvasElement,
  opts: LinkOverlayOptions,
): LinkOverlayHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Use a sentinel distinct from null to track "never called" vs "called with null".
  let lastMatchText: string | null | undefined = undefined;
  let lastMatchRow: number | null | undefined = undefined;

  // ─── Coordinate helpers ─────────────────────────────────────────────────

  /** Convert a MouseEvent to grid (col, row). Returns null if outside canvas. */
  function eventToGridPos(
    event: MouseEvent,
  ): { col: number; row: number } | null {
    const rect = canvas.getBoundingClientRect();
    // In test environments (jsdom), getBoundingClientRect() may return all
    // zeros. Fall back to canvas pixel dimensions for bounds checking.
    const canvasW = rect.width > 0 ? rect.width : canvas.width;
    const canvasH = rect.height > 0 ? rect.height : canvas.height;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x >= canvasW || y >= canvasH) return null;
    const col = Math.floor(x / opts.cellWidth);
    const row = Math.floor(y / opts.cellHeight);
    return { col, row };
  }

  /** Find the link at grid position (col, row), or null. */
  function findLinkAt(col: number, row: number): LinkMatch | null {
    const grid = opts.getGrid();
    if (!grid) return null;
    const links = extractLinks(grid);
    return (
      links.find(
        (l) => l.row === row && l.col_start <= col && col < l.col_end,
      ) ?? null
    );
  }

  // ─── mousemove handler (debounced) ──────────────────────────────────────

  function handleMousemove(event: MouseEvent) {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const pos = eventToGridPos(event);
      const match = pos ? findLinkAt(pos.col, pos.row) : null;
      const matchText = match?.text ?? null;
      const matchRow = match?.row ?? null;

      // Call onDecorate whenever the match changes OR on the very first call.
      if (matchText !== lastMatchText || matchRow !== lastMatchRow) {
        lastMatchText = matchText;
        lastMatchRow = matchRow;
        opts.onDecorate?.(match);
      }
    }, 30);
  }

  // ─── click handler ──────────────────────────────────────────────────────

  function handleClick(event: MouseEvent) {
    // Modifier check: Cmd (metaKey) on macOS, Ctrl on Linux.
    // isMac selects the platform-appropriate primary modifier; we also accept
    // the other modifier so that tests can run cross-platform without guards.
    const isModified = isMac
      ? event.metaKey || event.ctrlKey
      : event.ctrlKey || event.metaKey;
    if (!isModified) return;

    const pos = eventToGridPos(event);
    if (!pos) return;

    const match = findLinkAt(pos.col, pos.row);
    if (!match) return;

    if (match.kind === "url") {
      void invoke("open_url", { url: match.text }).catch((err: unknown) => {
        console.warn("[link-overlay] open_url failed:", err);
      });
    } else {
      // For file paths, use open_with_default_app (matches terminal-service.ts).
      void invoke("open_with_default_app", { path: match.text }).catch(
        (err: unknown) => {
          console.warn("[link-overlay] open_with_default_app failed:", err);
        },
      );
    }
  }

  // ─── Attach listeners ────────────────────────────────────────────────────

  canvas.addEventListener("mousemove", handleMousemove);
  canvas.addEventListener("click", handleClick);

  // ─── Handle ──────────────────────────────────────────────────────────────

  return {
    detach() {
      canvas.removeEventListener("mousemove", handleMousemove);
      canvas.removeEventListener("click", handleClick);
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      lastMatchText = undefined;
      lastMatchRow = undefined;
    },
  };
}
