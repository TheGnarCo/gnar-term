/**
 * mouse-handler.ts — AC-2 mouse-driven selection for AlacrittyTerminalSurface.
 *
 * Translates DOM mouse events on the canvas element into selection IPC calls:
 * - Single click + drag  → cell-mode (Simple) selection
 * - Double click         → word-mode (Semantic) selection
 * - Triple click         → line-mode (Lines) selection
 * - Shift + click        → extend the active selection
 *
 * The `attachMouse` function registers all listeners and returns a `MouseHandle`
 * with a `detach()` method for clean teardown. It does NOT import from Svelte
 * or touch `AlacrittyTerminalSurface.svelte` — wiring is cycle-21's job.
 *
 * ## IPC surface
 *
 * Calls `invoke("start_selection", { paneId, row, col, mode })`,
 *        `invoke("update_selection", { paneId, row, col })`,
 *        `invoke("clear_selection", { paneId })`.
 *
 * These Tauri commands are registered in cycle-21. In tests, the `InvokeFn`
 * option lets callers inject a mock so no Tauri runtime is needed.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

/** Selection granularity. Maps to the Rust `SelectionMode` enum. */
export type SelectionMode = "simple" | "semantic" | "lines";

/** Options accepted by `attachMouse`. */
export interface MouseOptions {
  /** Width of a single terminal cell in CSS pixels. */
  cell_width: number;
  /** Height of a single terminal cell in CSS pixels. */
  cell_height: number;
  /** Pane identifier forwarded to the Tauri `*_selection` commands. */
  paneId: string;
  /**
   * Optional Tauri `invoke` override for testing.
   * Defaults to `window.__TAURI__.core.invoke`.
   */
  invoke?: InvokeFn;
}

/** Signature of the Tauri `invoke` function (or a test double). */
export type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/** A `SelectionChangeEvent` is dispatched on the canvas when the selection changes. */
export interface SelectionChangeEvent extends CustomEvent {
  detail: {
    row: number;
    col: number;
    mode: SelectionMode;
    phase: "start" | "update" | "clear";
  };
}

/** Returned by `attachMouse`; call `detach()` to remove all listeners. */
export interface MouseHandle {
  /** Remove all DOM event listeners registered by `attachMouse`. */
  detach: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Double-click interval (ms). DOM fires dblclick after this; we track manually. */
const DOUBLE_CLICK_INTERVAL_MS = 300;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert pixel coordinates relative to the canvas to cell (col, row).
 *
 * Uses `Math.floor` so that moving into the right half of a cell still maps
 * to the same cell — consistent with terminal selection semantics.
 */
function pixelToCell(
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
): { col: number; row: number } {
  return {
    col: Math.max(0, Math.floor(x / cellWidth)),
    row: Math.max(0, Math.floor(y / cellHeight)),
  };
}

/** Return the canvas-relative offset for a mouse event. */
function eventOffset(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

// ─── attachMouse ─────────────────────────────────────────────────────────────

/**
 * Attach mouse-driven selection listeners to `canvas`.
 *
 * Returns a `MouseHandle` with a `detach()` method that removes every listener
 * added by this function. Safe to call multiple times (each call returns its
 * own independent handle with its own listener set).
 *
 * @param canvas - The terminal canvas element.
 * @param opts   - Cell metrics, pane identifier, and optional invoke override.
 */
export function attachMouse(
  canvas: HTMLCanvasElement,
  opts: MouseOptions,
): MouseHandle {
  const { cell_width, cell_height, paneId } = opts;

  // Use the injected invoke or fall back to the Tauri global.
  const invoke: InvokeFn =
    opts.invoke ??
    ((cmd, args) =>
      (
        window as unknown as {
          __TAURI__: { core: { invoke: InvokeFn } };
        }
      ).__TAURI__.core.invoke(cmd, args));

  // ── Internal state ─────────────────────────────────────────────────────────

  let isDragging = false;
  let lastClickTime = 0;
  let clickCount = 0;
  let pendingClickTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function cellAt(e: MouseEvent) {
    const { x, y } = eventOffset(e, canvas);
    return pixelToCell(x, y, cell_width, cell_height);
  }

  function dispatchSelectionChange(detail: SelectionChangeEvent["detail"]) {
    canvas.dispatchEvent(
      new CustomEvent("selection-change", { detail, bubbles: true }),
    );
  }

  // ── Mouse event handlers ───────────────────────────────────────────────────

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return; // Only handle left button.

    const { row, col } = cellAt(e);
    const now = Date.now();

    // Determine click count for mode selection.
    if (now - lastClickTime < DOUBLE_CLICK_INTERVAL_MS) {
      clickCount += 1;
    } else {
      clickCount = 1;
    }
    lastClickTime = now;

    if (pendingClickTimeout !== null) {
      clearTimeout(pendingClickTimeout);
      pendingClickTimeout = null;
    }

    const shiftHeld = e.shiftKey;

    if (shiftHeld) {
      // Shift-click: extend the current selection without starting a new one.
      invoke("update_selection", { paneId, row, col }).catch(() => {});
      dispatchSelectionChange({ row, col, mode: "simple", phase: "update" });
      isDragging = true;
      return;
    }

    // Determine mode from click count.
    let mode: SelectionMode;
    if (clickCount >= 3) {
      mode = "lines";
    } else if (clickCount === 2) {
      mode = "semantic";
    } else {
      mode = "simple";
    }

    invoke("start_selection", { paneId, row, col, mode }).catch(() => {});
    dispatchSelectionChange({ row, col, mode, phase: "start" });
    isDragging = true;
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const { row, col } = cellAt(e);
    invoke("update_selection", { paneId, row, col }).catch(() => {});
    dispatchSelectionChange({ row, col, mode: "simple", phase: "update" });
  }

  function onMouseUp(e: MouseEvent) {
    if (e.button !== 0) return;
    isDragging = false;
  }

  // Clicking outside the canvas clears the selection.
  function onDocumentMouseDown(e: MouseEvent) {
    if (e.target === canvas) return;
    invoke("clear_selection", { paneId }).catch(() => {});
    dispatchSelectionChange({ row: 0, col: 0, mode: "simple", phase: "clear" });
    clickCount = 0;
  }

  // If the user releases the mouse outside the canvas, stop dragging.
  function onDocumentMouseUp() {
    isDragging = false;
  }

  // ── Register listeners ─────────────────────────────────────────────────────

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  document.addEventListener("mousedown", onDocumentMouseDown);
  document.addEventListener("mouseup", onDocumentMouseUp);

  // ── MouseHandle ────────────────────────────────────────────────────────────

  return {
    detach() {
      if (pendingClickTimeout !== null) {
        clearTimeout(pendingClickTimeout);
      }
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousedown", onDocumentMouseDown);
      document.removeEventListener("mouseup", onDocumentMouseUp);
    },
  };
}
