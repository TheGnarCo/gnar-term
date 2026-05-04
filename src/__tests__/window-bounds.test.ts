import { describe, it, expect } from "vitest";
import { clampBoundsToMonitorList } from "../lib/services/window-bounds-service";

const monitor = (x: number, y: number, w: number, h: number) => ({
  position: { x, y },
  size: { width: w, height: h },
});

describe("clampBoundsToMonitorList", () => {
  it("returns (0,0) when monitor list is empty", () => {
    expect(clampBoundsToMonitorList([], 500, 500, 1200, 800)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("returns original coords when window is within the monitor", () => {
    const monitors = [monitor(0, 0, 1920, 1080)];
    expect(clampBoundsToMonitorList(monitors, 100, 100, 1200, 800)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("clamps x when window origin is beyond the right edge", () => {
    const monitors = [monitor(0, 0, 1920, 1080)];
    // x=5000 is off-screen; clamps to maxX(1920) - min(w,100) = 1820
    const result = clampBoundsToMonitorList(monitors, 5000, 100, 1200, 800);
    expect(result.x).toBe(1820);
    expect(result.y).toBe(100);
  });

  it("clamps y when window origin is below the bottom edge", () => {
    const monitors = [monitor(0, 0, 1920, 1080)];
    const result = clampBoundsToMonitorList(monitors, 100, 5000, 1200, 800);
    expect(result.x).toBe(100);
    expect(result.y).toBe(980); // 1080 - min(800,100) = 980
  });

  it("clamps to monitor minimum when coords are negative beyond left/top edge", () => {
    const monitors = [monitor(0, 0, 1920, 1080)];
    const result = clampBoundsToMonitorList(monitors, -9999, -9999, 1200, 800);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("handles multi-monitor setup — window in second monitor is in bounds", () => {
    const monitors = [monitor(0, 0, 1920, 1080), monitor(1920, 0, 1920, 1080)];
    // Window origin at (2000, 100) is on the second monitor — in bounds
    const result = clampBoundsToMonitorList(monitors, 2000, 100, 1200, 800);
    expect(result.x).toBe(2000);
    expect(result.y).toBe(100);
  });

  it("handles multi-monitor setup — window off all monitors gets clamped", () => {
    const monitors = [monitor(0, 0, 1920, 1080), monitor(1920, 0, 1920, 1080)];
    // x=9999 is beyond maxX(3840) - 100 = 3740
    const result = clampBoundsToMonitorList(monitors, 9999, 9999, 1200, 800);
    expect(result.x).toBe(3740);
    expect(result.y).toBe(980);
  });
});
