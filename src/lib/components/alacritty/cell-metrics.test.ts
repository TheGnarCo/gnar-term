/**
 * cell-metrics.test.ts — unit tests for cell-metrics.ts
 *
 * Tests verify:
 *  - cell_metrics_measure_returns_correct_dimensions
 *  - cell_metrics_recomputes_after_font_size_change
 *  - cell_metrics_handles_dpr_scaling
 *  - cell_metrics_unsubscribe_stops_callbacks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CellMetrics } from "./cell-metrics";
import { fontSize, DEFAULT_FONT_SIZE } from "../../stores/font-size";

// ─── Canvas mock ───────────────────────────────────────────────────────────────

/**
 * Build a mock 2d context that returns `mockWidth` for every measureText call
 * and exposes the last `font` string that was set on the context.
 */
function mockContext(mockWidth: number = 8) {
  const lastFont = { value: "" };
  return {
    get font() {
      return lastFont.value;
    },
    set font(v: string) {
      lastFont.value = v;
    },
    measureText: vi.fn().mockReturnValue({
      width: mockWidth,
      // Omit fontBoundingBoxAscent/Descent to exercise the fallback path
    }),
    _lastFont: lastFont,
  };
}

/**
 * Inject a mock context into a `CellMetrics` instance by overriding
 * the private `_ensureContext` method.
 */
function withMockContext(
  metrics: CellMetrics,
  ctx: ReturnType<typeof mockContext>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (metrics as any)._ensureContext = () => ctx;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("cell_metrics", () => {
  let metrics: CellMetrics;
  let ctx: ReturnType<typeof mockContext>;

  beforeEach(() => {
    metrics = new CellMetrics();
    ctx = mockContext(8);
    withMockContext(metrics, ctx);
    // Reset font size store to default
    fontSize.set(DEFAULT_FONT_SIZE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cell_metrics_measure_returns_correct_dimensions for standard options", () => {
    const dims = metrics.measure({
      fontFamily: "monospace",
      fontSize: 14,
      dpr: 1,
    });

    // Width comes from measureText mock (8) × dpr (1) = 8
    expect(dims.cellWidth).toBe(8);

    // Height uses fallback: 14 * 1.2 = 16.8 → Math.round(16.8) = 17
    expect(dims.cellHeight).toBe(Math.round(14 * 1.2));

    // Baseline: 14 * 1.0 = 14 → Math.round(14) = 14
    expect(dims.baseline).toBe(Math.round(14 * 1.0));
  });

  it("cell_metrics_handles_dpr_scaling correctly for dpr=2", () => {
    // Mock returns width 8 — at dpr=2, cellWidth = round(8*2)/2 = 8
    const dims = metrics.measure({
      fontFamily: "monospace",
      fontSize: 14,
      dpr: 2,
    });

    // Width: round(8 * 2) / 2 = 16 / 2 = 8 (same logical width)
    expect(dims.cellWidth).toBe(8);

    // Height: round(14 * 1.2 * 2) / 2 = round(33.6) / 2 = 34 / 2 = 17
    expect(dims.cellHeight).toBe(Math.round(14 * 1.2 * 2) / 2);
  });

  it("cell_metrics_measure sets font on context with correct fontSize and fontFamily", () => {
    metrics.measure({ fontFamily: "JetBrains Mono", fontSize: 16, dpr: 1 });

    // Context font should have been set
    expect(ctx.measureText).toHaveBeenCalledWith("M");
    expect(ctx.font).toBe("16px JetBrains Mono");
  });

  it("cell_metrics_measure uses fontBoundingBox when available", () => {
    // Override mock to include bounding box metrics
    ctx.measureText = vi.fn().mockReturnValue({
      width: 8,
      fontBoundingBoxAscent: 12,
      fontBoundingBoxDescent: 3,
    });

    const dims = metrics.measure({
      fontFamily: "monospace",
      fontSize: 14,
      dpr: 1,
    });

    // Height = round((12 + 3) * 1) / 1 = 15
    expect(dims.cellHeight).toBe(15);
    // Baseline = round(12 * 1) / 1 = 12
    expect(dims.baseline).toBe(12);
  });

  it("cell_metrics_recomputes_after_font_size_change triggers callback with new dims", async () => {
    const received: import("./cell-metrics").CellDimensions[] = [];
    const unsub = metrics.subscribe((dims) => received.push(dims), "monospace");

    const initialCount = received.length;

    // Change font size — store subscription should fire the callback again
    fontSize.set(18);

    // Allow microtask queue to drain
    await Promise.resolve();

    expect(received.length).toBeGreaterThan(initialCount);

    // The new measurement should use fontSize=18: height = round(18*1.2) = 22
    const last = received[received.length - 1]!;
    expect(last.cellHeight).toBe(Math.round(18 * 1.2));

    unsub();
    fontSize.set(DEFAULT_FONT_SIZE);
  });

  it("cell_metrics_unsubscribe_stops_callbacks after detach", async () => {
    const received: import("./cell-metrics").CellDimensions[] = [];
    const unsub = metrics.subscribe((dims) => received.push(dims), "monospace");

    const countAfterAttach = received.length;
    unsub();

    // Change font size — should NOT fire callback after unsubscribe
    fontSize.set(20);
    await Promise.resolve();

    expect(received.length).toBe(countAfterAttach);

    fontSize.set(DEFAULT_FONT_SIZE);
  });

  it("cell_metrics_measure cellWidth equals measureText width at dpr=1", () => {
    ctx.measureText = vi.fn().mockReturnValue({ width: 9.5 });
    const dims = metrics.measure({
      fontFamily: "monospace",
      fontSize: 14,
      dpr: 1,
    });
    // round(9.5 * 1) / 1 = 10
    expect(dims.cellWidth).toBe(10);
  });

  it("cell_metrics subscribe fires immediately on attach with current dimensions", () => {
    const received: import("./cell-metrics").CellDimensions[] = [];
    const unsub = metrics.subscribe((dims) => received.push(dims), "monospace");

    // Should have fired at least once synchronously (font-size store fires on subscribe)
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]).toBeDefined();
    expect(typeof received[0]!.cellWidth).toBe("number");
    expect(typeof received[0]!.cellHeight).toBe("number");
    expect(typeof received[0]!.baseline).toBe("number");

    unsub();
  });
});
