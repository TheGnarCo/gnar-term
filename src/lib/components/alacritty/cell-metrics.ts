/**
 * cell-metrics.ts — Off-screen canvas measurement of monospace cell dimensions.
 *
 * Provides `CellMetrics.measure()` for one-shot queries, and a `subscribe()`
 * method that fires whenever the font-size store changes or the document is
 * resized (DPR-change via ResizeObserver on a sentinel element).
 *
 * cycle-21 calls `metrics.subscribe(({ cellWidth, cellHeight }) => ...)` from
 * `AlacrittyTerminalSurface.svelte` and forwards the new dims to
 * `PtyBridge::resize`.
 */

import { fontSize } from "../../stores/font-size";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CellDimensions {
  cellWidth: number;
  cellHeight: number;
  baseline: number;
}

export interface MeasureOptions {
  fontFamily: string;
  fontSize: number;
  dpr: number;
}

export type MetricsCallback = (dims: CellDimensions) => void;

// ─── CellMetrics class ─────────────────────────────────────────────────────────

/**
 * Measures monospace cell dimensions using an off-screen canvas.
 *
 * The canvas is created lazily on first `measure()` call so that module-level
 * import does not touch the DOM.  This keeps the module tree-shakeable in
 * non-browser environments (Rust test workers, etc.).
 */
export class CellMetrics {
  /** Off-screen canvas shared across all measure() calls for efficiency. */
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;

  /** Active subscriptions: font-size store unsubscribe + ResizeObserver. */
  private _fontUnsub: (() => void) | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _callbacks: Set<MetricsCallback> = new Set();

  /** Sentinel element for DPR-change detection via ResizeObserver. */
  private _sentinel: HTMLElement | null = null;

  /** Most recently resolved font family (from the subscribe context). */
  private _fontFamily: string = "monospace";

  /**
   * One-shot measurement — does not set up any subscriptions.
   *
   * Uses `measureText("M")` to get the advance width of a representative
   * capital glyph.  Height is derived from `fontBoundingBoxAscent +
   * fontBoundingBoxDescent` when available (modern browsers), falling back to
   * `fontSize * 1.2` rounded to the nearest integer (consistent with most
   * terminal emulators).
   */
  measure(opts: MeasureOptions): CellDimensions {
    const ctx = this._ensureContext();
    ctx.font = `${opts.fontSize}px ${opts.fontFamily}`;

    const metrics = ctx.measureText("M");

    // Width: advance width of "M" scaled by DPR
    const cellWidth = Math.round(metrics.width * opts.dpr) / opts.dpr;

    // Height: prefer fontBounding box when available
    let ascent: number;
    let totalHeight: number;
    if (
      typeof (metrics as TextMetrics & { fontBoundingBoxAscent?: number })
        .fontBoundingBoxAscent === "number" &&
      typeof (metrics as TextMetrics & { fontBoundingBoxDescent?: number })
        .fontBoundingBoxDescent === "number"
    ) {
      ascent = (metrics as TextMetrics & { fontBoundingBoxAscent: number })
        .fontBoundingBoxAscent;
      const descent = (
        metrics as TextMetrics & { fontBoundingBoxDescent: number }
      ).fontBoundingBoxDescent;
      totalHeight = ascent + descent;
    } else {
      // Fallback: industry-standard 1.2× line-height; ascent occupies ~83% of the line.
      // Using 1.2 × fontSize as the total cell height keeps cells legible at all sizes.
      totalHeight = opts.fontSize * 1.2;
      ascent = opts.fontSize * 1.0; // topline to baseline ≈ 1em
    }

    const cellHeight = Math.round(totalHeight * opts.dpr) / opts.dpr;
    const baseline = Math.round(ascent * opts.dpr) / opts.dpr;

    return { cellWidth, cellHeight, baseline };
  }

  /**
   * Subscribe to cell-dimension changes.
   *
   * Fires immediately with the current dimensions (using `fontFamily` and the
   * current `fontSize` store value), then again whenever:
   *  - the `fontSize` store emits a new value, OR
   *  - the device pixel ratio changes (detected via ResizeObserver on a
   *    1×1 pixel sentinel element sized with CSS `1px` in logical units).
   *
   * Returns an `unsubscribe` function.
   */
  subscribe(
    callback: MetricsCallback,
    fontFamily: string = "monospace",
  ): () => void {
    this._fontFamily = fontFamily;
    this._callbacks.add(callback);

    // Set up font-size store subscription once
    if (!this._fontUnsub) {
      this._fontUnsub = fontSize.subscribe((size) => {
        this._emit(size);
      });
    }

    // Set up ResizeObserver for DPR changes once
    if (!this._resizeObserver && typeof ResizeObserver !== "undefined") {
      this._sentinel = this._createSentinel();
      this._resizeObserver = new ResizeObserver(() => {
        // DPR change fires a resize event on the sentinel; re-emit
        this._emit();
      });
      if (this._sentinel.parentNode) {
        // Already attached — observe
      } else if (typeof document !== "undefined") {
        document.body.appendChild(this._sentinel);
      }
      this._resizeObserver.observe(this._sentinel);
    }

    return () => {
      this._callbacks.delete(callback);
      if (this._callbacks.size === 0) {
        this._teardown();
      }
    };
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private _ensureContext(): CanvasRenderingContext2D {
    if (this._ctx) return this._ctx;

    if (typeof document !== "undefined") {
      this._canvas = document.createElement("canvas");
      this._canvas.width = 64;
      this._canvas.height = 64;
      const ctx = this._canvas.getContext("2d");
      if (ctx) {
        this._ctx = ctx;
        return ctx;
      }
    }

    // Fallback for environments where canvas is not available (test injection)
    throw new Error("CellMetrics: canvas 2d context not available");
  }

  private _emit(size?: number): void {
    // Import current font size from store if not passed
    let currentSize = size;
    if (currentSize === undefined) {
      // Read current store value synchronously via subscription trick
      let s = 14;
      const unsub = fontSize.subscribe((v) => {
        s = v;
      });
      unsub();
      currentSize = s;
    }

    const dpr =
      typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
    try {
      const dims = this.measure({
        fontFamily: this._fontFamily,
        fontSize: currentSize,
        dpr,
      });
      for (const cb of this._callbacks) {
        cb(dims);
      }
    } catch {
      // Canvas not available — skip (e.g. jsdom without canvas mock)
    }
  }

  private _createSentinel(): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden;";
    return el;
  }

  private _teardown(): void {
    if (this._fontUnsub) {
      this._fontUnsub();
      this._fontUnsub = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._sentinel && this._sentinel.parentNode) {
      this._sentinel.parentNode.removeChild(this._sentinel);
      this._sentinel = null;
    }
  }
}

/**
 * Singleton CellMetrics instance for use by the AlacrittyTerminalSurface.
 * Modules that need ad-hoc measurement can import and call this directly.
 */
export const cellMetrics = new CellMetrics();
