/**
 * Window-bounds persistence — restores the prior window size/position on
 * launch and records the current size/position on quit.
 *
 * Backed by `AppState.windowBounds` (config.ts). Without this service,
 * `windowBounds` is declared on the state but never read or written, so
 * every launch opens at the hardcoded Tauri default (1200×800).
 *
 * Both helpers are best-effort: failures are logged and swallowed so a
 * misbehaving Tauri window API can't strand the launch sequence or
 * block a user-initiated quit.
 */
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { availableMonitors } from "@tauri-apps/api/window";
import { saveState, type AppState } from "../config";

/**
 * Minimal slice of the Tauri Window API used here. Declared structurally
 * so tests can supply a plain object without dragging in the real
 * `@tauri-apps/api/window` Window class.
 *
 * Bounds are exchanged in **physical pixels** end-to-end. `outerSize` and
 * `outerPosition` return PhysicalSize/PhysicalPosition in Tauri v2; using
 * Logical units on the restore side would cause Tauri to multiply by the
 * device pixel ratio, doubling the window each launch on Retina/HiDPI
 * displays.
 */
export interface WindowBoundsApi {
  setSize(size: PhysicalSize): Promise<void>;
  setPosition(position: PhysicalPosition): Promise<void>;
  outerSize(): Promise<{ width: number; height: number }>;
  outerPosition(): Promise<{ x: number; y: number }>;
}

interface MonitorLike {
  position: { x: number; y: number };
  size: { width: number; height: number };
}

/** Pure helper — clamp (x, y) so the window is visible on at least one monitor. */
export function clampBoundsToMonitorList(
  monitors: MonitorLike[],
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  if (monitors.length === 0) return { x: 0, y: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const m of monitors) {
    minX = Math.min(minX, m.position.x);
    minY = Math.min(minY, m.position.y);
    maxX = Math.max(maxX, m.position.x + m.size.width);
    maxY = Math.max(maxY, m.position.y + m.size.height);
  }
  return {
    x: Math.max(minX, Math.min(x, maxX - Math.min(w, 100))),
    y: Math.max(minY, Math.min(y, maxY - Math.min(h, 100))),
  };
}

async function clampToMonitors(
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<{ x: number; y: number }> {
  try {
    const monitors = await availableMonitors();
    return clampBoundsToMonitorList(monitors, x, y, w, h);
  } catch {
    return { x: 0, y: 0 };
  }
}

/**
 * Apply persisted bounds (if any) to the live window. Size and position
 * are applied independently so a partially-populated record (e.g. only
 * size from a multi-monitor unplug) still does what it can.
 */
export async function restoreWindowBounds(
  bounds: AppState["windowBounds"],
  appWindow: WindowBoundsApi,
): Promise<void> {
  if (!bounds) return;
  try {
    if (bounds.width != null && bounds.height != null) {
      await appWindow.setSize(new PhysicalSize(bounds.width, bounds.height));
    }
    if (bounds.x != null && bounds.y != null) {
      const { x, y } = await clampToMonitors(
        bounds.x,
        bounds.y,
        bounds.width ?? 1200,
        bounds.height ?? 800,
      );
      await appWindow.setPosition(new PhysicalPosition(x, y));
    }
  } catch (err) {
    console.warn("[startup] failed to restore window bounds:", err);
  }
}

/**
 * Capture the live window's size + position and persist them to AppState
 * via `saveState`. Called from the quit handler before the window is
 * destroyed.
 */
export async function saveWindowBounds(
  appWindow: WindowBoundsApi,
): Promise<void> {
  try {
    const [size, pos] = await Promise.all([
      appWindow.outerSize(),
      appWindow.outerPosition(),
    ]);
    await saveState({
      windowBounds: {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
      },
    });
  } catch (err) {
    console.warn("[shutdown] failed to save window bounds:", err);
  }
}
