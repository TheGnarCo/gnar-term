/**
 * scroll-anchor.ts — Viewport scroll preservation during PTY writes.
 *
 * When a user scrolls up in the terminal to review history, PTY output should
 * append to the scrollback buffer without snapping the visible viewport back to
 * the bottom. This mirrors the behaviour implemented in xterm.js's
 * `flushPtyBuffer` in `terminal-service.ts`:
 *
 *   ```
 *   const savedViewportY = surface.terminal.buffer.active.viewportY;
 *   const maxScrollBefore = Math.max(0, length - rows);
 *   const wasScrolledUp = savedViewportY < maxScrollBefore;
 *   surface.terminal.write(merged, () => {
 *     if (wasScrolledUp) {
 *       surface.terminal.scrollLines(savedViewportY - newViewportY);
 *     }
 *   });
 *   ```
 *
 * `ScrollAnchor` captures the equivalent state for the alacritty canvas
 * renderer. The renderer calls `onUserScroll` when the user explicitly scrolls
 * (via wheel / keyboard), `onNewContent` when new PTY data arrives, and
 * `effectiveTopRow` to know which row to paint at the top of the canvas.
 *
 * # Coordinate convention
 *
 * `offset` is measured **from the bottom** of the scrollback buffer. A value
 * of 0 means "pinned to the bottom" (newest output visible). A value of N
 * means the user has scrolled N rows up from the bottom.
 *
 * Integration (cycle-21):
 *   `AlacrittyTerminalSurface.svelte` creates one `ScrollAnchor` per surface,
 *   calls `onUserScroll` from the wheel handler, and passes `effectiveTopRow`
 *   to the renderer before painting each frame.
 */

// ─── GridSnapshot interface (minimal, avoids circular imports) ────────────────

/**
 * Minimal view of the grid needed by `ScrollAnchor.effectiveTopRow`.
 *
 * Compatible with the full `GridSnapshot` from `ipc.ts` (superset).
 */
export interface GridView {
  /** Total rows in the scrollback buffer (history + viewport). */
  total_rows: number;
  /** Visible viewport height in rows. */
  rows: number;
}

// ─── ScrollAnchor ─────────────────────────────────────────────────────────────

/**
 * Tracks user scroll position and preserves the viewport during PTY writes.
 *
 * Call `onUserScroll(offset)` when the user moves the viewport. Call
 * `onNewContent()` when new PTY data has been rendered. Query
 * `effectiveTopRow(grid)` to get the top row index for the renderer.
 */
export class ScrollAnchor {
  /**
   * Current scroll offset measured from the bottom of the scrollback buffer.
   * 0 = pinned to newest output. Positive = scrolled up N rows.
   */
  private offsetFromBottom = 0;

  /**
   * Register a user-initiated scroll.
   *
   * @param offsetFromBottom Distance in rows from the bottom of the scrollback
   *   buffer. Must be ≥ 0. Clamped to 0 if negative (shouldn't happen but
   *   defensive). The caller is responsible for clamping to the scrollback
   *   maximum so we don't over-scroll.
   */
  onUserScroll(offsetFromBottom: number): void {
    this.offsetFromBottom = Math.max(0, offsetFromBottom);
  }

  /**
   * Returns `true` when the viewport is scrolled up and should be held in
   * place when new content arrives.
   *
   * A value of `true` means the renderer must NOT auto-scroll to the bottom
   * on the next frame.
   */
  shouldHoldOnNewContent(): boolean {
    return this.offsetFromBottom > 0;
  }

  /**
   * Compute the top-row index into the scrollback buffer for the renderer.
   *
   * The renderer paints rows `[topRow, topRow + grid.rows)` from the grid.
   *
   * @param grid Current grid view (total_rows × rows).
   * @returns Zero-based index of the first visible row. Clamped to `[0,
   *   max(0, total_rows - rows)]`.
   */
  effectiveTopRow(grid: GridView): number {
    const maxOffset = Math.max(0, grid.total_rows - grid.rows);
    // offsetFromBottom=0 → topRow = total_rows - rows (bottom of buffer)
    // offsetFromBottom=N → topRow = total_rows - rows - N (N rows above bottom)
    const topRow = maxOffset - this.offsetFromBottom;
    return Math.max(0, Math.min(maxOffset, topRow));
  }

  /**
   * Called when new PTY content has been appended to the scrollback buffer.
   *
   * If the viewport is not pinned to the bottom (`offsetFromBottom > 0`) the
   * anchor is left unchanged — the visible rows stay at the same scrollback
   * position, effectively holding the viewport. If the viewport IS at the
   * bottom the anchor stays at 0 (auto-scroll).
   *
   * Returns `true` when the caller must re-render to reflect the held position,
   * `false` when the viewport was already at the bottom and auto-scroll applies.
   */
  onNewContent(): boolean {
    return this.offsetFromBottom > 0;
  }

  /**
   * Reset the scroll anchor to the bottom (pinned to newest output).
   *
   * Call when the user explicitly scrolls to the bottom or a pane is
   * re-focused.
   */
  scrollToBottom(): void {
    this.offsetFromBottom = 0;
  }

  /** Read-only access to the current offset for testing and serialisation. */
  get currentOffset(): number {
    return this.offsetFromBottom;
  }
}
