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
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { saveState, type AppState } from "../config";

/**
 * Minimal slice of the Tauri Window API used here. Declared structurally
 * so tests can supply a plain object without dragging in the real
 * `@tauri-apps/api/window` Window class.
 */
export interface WindowBoundsApi {
  setSize(size: LogicalSize): Promise<void>;
  setPosition(position: LogicalPosition): Promise<void>;
  outerSize(): Promise<{ width: number; height: number }>;
  outerPosition(): Promise<{ x: number; y: number }>;
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
      await appWindow.setSize(new LogicalSize(bounds.width, bounds.height));
    }
    if (bounds.x != null && bounds.y != null) {
      await appWindow.setPosition(new LogicalPosition(bounds.x, bounds.y));
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
