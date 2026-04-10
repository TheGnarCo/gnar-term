/**
 * Guards against the Linux WebKitGTK resize → redraw → resize loop (#46).
 *
 * On Linux, WebKitGTK fires spurious ResizeObserver callbacks when terminal
 * content is written, even when container dimensions haven't changed. This
 * triggers fitAddon.fit() → resize_pty → SIGWINCH → full-screen redraw → loop.
 *
 * On macOS (WKWebView), these guards are effectively no-ops: WKWebView only
 * fires ResizeObserver on real container size changes, so the dedup checks
 * always pass through and the existing behavior is unchanged.
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
 * On macOS this is a no-op guard — WKWebView doesn't fire spurious resizes,
 * so the dedup check passes through every time.
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
 * On macOS this always returns true for real resizes — WKWebView's ResizeObserver
 * only fires when the container actually changed size.
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
 * Allows 1-row tolerance to account for partial-line rendering.
 */
export function isScrolledToBottom(terminal: Terminal): boolean {
  const buf = terminal.buffer.active;
  return buf.viewportY >= buf.baseY - 1;
}

// --- Scroll Anchor ---
// Persistent per-surface scroll anchor, set by user wheel events (not by
// xterm.js auto-scroll). Survives across rapid flushPtyBuffer cycles where
// checking viewport position is unreliable because xterm auto-scrolls
// during write() before our restore callback fires.

/** Map of ptyId → viewport line the user scrolled to (absent = at bottom). */
const scrollAnchors = new Map<number, number>();

/** Get the scroll anchor for a PTY, or null if viewport should auto-scroll. */
export function getScrollAnchor(ptyId: number): number | null {
  return scrollAnchors.get(ptyId) ?? null;
}

/** Clear the scroll anchor (user scrolled back to bottom or surface closed). */
export function clearScrollAnchor(ptyId: number): void {
  scrollAnchors.delete(ptyId);
}

/**
 * Wire up scroll anchoring on a terminal's DOM element.
 * Listens for wheel events (user-initiated scroll) and updates the anchor.
 * Auto-scrolls from terminal.write() don't trigger wheel events, so the
 * anchor is stable during active output.
 *
 * Cross-platform: when viewport is at the bottom (the default), no anchor
 * is set and flushPtyBuffer auto-scrolls normally.
 */
export function setupScrollAnchor(
  termElement: HTMLElement,
  terminal: Terminal,
  getPtyId: () => number,
): void {
  termElement.addEventListener("wheel", () => {
    // Read viewport position after xterm.js processes the scroll
    requestAnimationFrame(() => {
      const ptyId = getPtyId();
      if (ptyId < 0) return;
      if (isScrolledToBottom(terminal)) {
        scrollAnchors.delete(ptyId);
      } else {
        scrollAnchors.set(ptyId, terminal.buffer.active.viewportY);
      }
    });
  });
}
