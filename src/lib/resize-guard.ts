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
//
// Intercepts xterm.js auto-scroll during write() to keep the viewport anchored
// when the user has scrolled up. The key insight: terminal.onScroll fires
// synchronously during write() processing, BEFORE the browser paints. By
// calling scrollToLine(anchor) in the onScroll handler, the viewport is
// corrected before any frame is rendered — zero flicker.
//
// A writeInFlight flag distinguishes auto-scrolls (during write) from user
// scrolls (wheel, keyboard, scrollbar). User scrolls update the anchor;
// auto-scrolls are counteracted.
//
// On macOS this is effectively a no-op — when no anchor is set (user at
// bottom), the onScroll handler returns early and auto-scroll proceeds normally.

/** Map of ptyId → viewport line the user scrolled to (absent = at bottom). */
const scrollAnchors = new Map<number, number>();

/** Tracks whether a terminal.write() is in progress for each PTY. */
const writeInFlight = new Set<number>();

/** Re-entrancy guard: prevents our scrollToLine restore from re-triggering onScroll. */
const restoreInFlight = new Set<number>();

/** Get the scroll anchor for a PTY, or null if viewport should auto-scroll. */
export function getScrollAnchor(ptyId: number): number | null {
  return scrollAnchors.get(ptyId) ?? null;
}

/** Clear the scroll anchor (user scrolled back to bottom or surface closed). */
export function clearScrollAnchor(ptyId: number): void {
  scrollAnchors.delete(ptyId);
}

/** Mark that a terminal.write() is starting for this PTY. */
export function markWriteStart(ptyId: number): void {
  writeInFlight.add(ptyId);
}

/** Mark that a terminal.write() has completed for this PTY. */
export function markWriteEnd(ptyId: number): void {
  writeInFlight.delete(ptyId);
}

/**
 * Wire up scroll anchoring via terminal.onScroll.
 *
 * The onScroll handler serves two purposes:
 * 1. When no write is in-flight → user-initiated scroll → update/clear anchor
 * 2. When a write IS in-flight → auto-scroll from write() → counteract by
 *    restoring the anchor immediately (before render)
 *
 * This replaces the previous wheel-event-only approach which couldn't prevent
 * the one-frame flicker between auto-scroll and restore.
 */
export function setupScrollAnchor(
  terminal: Terminal,
  getPtyId: () => number,
): void {
  terminal.onScroll(() => {
    const ptyId = getPtyId();
    if (ptyId < 0) return;

    // Don't re-enter when our own scrollToLine triggers onScroll
    if (restoreInFlight.has(ptyId)) return;

    if (!writeInFlight.has(ptyId)) {
      // No write in-flight → this is a user scroll (wheel, keyboard, scrollbar).
      // Update or clear the anchor based on current position.
      if (isScrolledToBottom(terminal)) {
        scrollAnchors.delete(ptyId);
      } else {
        scrollAnchors.set(ptyId, terminal.buffer.active.viewportY);
      }
      return;
    }

    // Write in-flight → auto-scroll from terminal.write(). Counteract it.
    const anchor = scrollAnchors.get(ptyId);
    if (anchor == null) return;

    // Cap anchor at current buffer size in case scrollback was trimmed
    const effectiveAnchor = Math.min(anchor, terminal.buffer.active.baseY);

    restoreInFlight.add(ptyId);
    terminal.scrollToLine(effectiveAnchor);
    restoreInFlight.delete(ptyId);
  });
}
