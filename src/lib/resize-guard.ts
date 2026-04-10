/**
 * Guards against the Linux WebKitGTK resize → redraw → resize loop (#46).
 *
 * On Linux, WebKitGTK fires spurious ResizeObserver callbacks when terminal
 * content is written, even when container dimensions haven't changed. This
 * triggers fitAddon.fit() → resize_pty → SIGWINCH → full-screen redraw → loop.
 * The resize cycle also breaks xterm.js's native scroll lock (isUserScrolling)
 * via the Viewport._sync() → scrollLines() path, which clears the flag.
 *
 * On macOS (WKWebView), these guards are effectively no-ops: WKWebView only
 * fires ResizeObserver on real container size changes, so the dedup checks
 * always pass through and the existing behavior is unchanged.
 *
 * xterm.js already has built-in scroll lock via BufferService.isUserScrolling.
 * When the user scrolls up, it sets isUserScrolling=true and subsequent write()
 * calls don't auto-scroll. These guards protect that flag by preventing the
 * spurious resize cycles that would clear it.
 */
import { invoke } from "@tauri-apps/api/core";

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
