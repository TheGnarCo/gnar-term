/**
 * Guards against the Linux WebKitGTK resize → redraw → resize loop (#46).
 *
 * On Linux, WebKitGTK fires spurious ResizeObserver callbacks when terminal
 * content is written, even when container dimensions haven't changed. This
 * triggers fitAddon.fit() → resize_pty → SIGWINCH → full-screen redraw → loop.
 *
 * These utilities break the loop at two points:
 * 1. createResizeHandler — deduplicates resize_pty calls (same cols/rows = no-op)
 * 2. shouldFit — skips fitAddon.fit() when container pixel dims are unchanged
 * 3. isScrolledToBottom — detects user scroll position for scroll anchoring
 */
import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";

/**
 * Creates a resize handler that deduplicates resize_pty calls.
 * Only invokes resize_pty when cols or rows actually change.
 *
 * @param getPtyId - function returning current ptyId (may change over surface lifetime)
 */
export function createResizeHandler(getPtyId: () => number) {
  let lastCols = 0;
  let lastRows = 0;

  return ({ cols, rows }: { cols: number; rows: number }) => {
    const ptyId = getPtyId();
    if (ptyId < 0) return;
    if (cols === lastCols && rows === lastRows) return;
    lastCols = cols;
    lastRows = rows;
    invoke("resize_pty", { ptyId, cols, rows });
  };
}

/**
 * Checks whether fitAddon.fit() should run based on container pixel dimensions.
 * Returns false (skip) when width and height are unchanged from last call.
 */
export function shouldFit(
  width: number,
  height: number,
  state: { lastWidth: number; lastHeight: number },
): boolean {
  if (width === state.lastWidth && height === state.lastHeight) return false;
  state.lastWidth = width;
  state.lastHeight = height;
  return true;
}

/**
 * Detects whether the terminal viewport is scrolled to the bottom.
 * Used to decide whether new PTY output should auto-scroll or preserve position.
 * Allows 1-row tolerance to account for partial-line rendering.
 */
export function isScrolledToBottom(terminal: Terminal): boolean {
  const buf = terminal.buffer.active;
  return buf.viewportY >= buf.baseY - 1;
}
