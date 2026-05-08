/**
 * Routes Tauri-native drag-drop events to the pane under the cursor.
 *
 * `tauri://drag-*` events are window-wide. Without routing, every visible
 * TerminalSurface listener fires on every drop, which inserts the same
 * image into every Claude in every split. This module installs a single
 * listener set, hit-tests the cursor position against rendered pane
 * elements (`[data-pane-body]`), and dispatches the drop only to the
 * pane under the cursor.
 *
 * Hover behavior: while a drag is in progress, the pane under the cursor
 * is briefly made active so the user can see where the drop will land.
 * If the drag is cancelled (leaves the window) or moves off all panes,
 * the original active pane is restored.
 */
import { get } from "svelte/store";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { workspaces, activeWorkspace } from "../stores/workspace";
import { focusPane } from "./pane-service";
import { getAllPanes, isTerminalSurface, type Pane } from "../types";

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "tiff",
  "ico",
  "avif",
]);

function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.has(ext);
}

function shellEscape(path: string): string {
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

/**
 * Hit-test position against rendered panes.
 * Walks the element under the point up to the nearest [data-pane-body].
 */
function paneIdAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const paneEl = el.closest("[data-pane-body]") as HTMLElement | null;
  return paneEl?.getAttribute("data-pane-body") ?? null;
}

function findPaneById(paneId: string): Pane | null {
  for (const ws of get(workspaces)) {
    for (const pane of getAllPanes(ws.paneLayout)) {
      if (pane.id === paneId) return pane;
    }
  }
  return null;
}

/**
 * Drag session state. We capture the originally-active pane on the first
 * drag-enter so we can restore it if the user cancels the drag.
 */
let originalActivePaneId: string | null = null;
let dragSessionActive = false;

function ensureSession(): void {
  if (dragSessionActive) return;
  const ws = get(activeWorkspace);
  originalActivePaneId = ws?.activePaneId ?? null;
  dragSessionActive = true;
}

function endSession(restore: boolean): void {
  if (!dragSessionActive) return;
  const restoreId = originalActivePaneId;
  dragSessionActive = false;
  originalActivePaneId = null;
  if (restore && restoreId) focusPane(restoreId);
}

function handleHoverPaneId(paneId: string | null): void {
  ensureSession();
  if (paneId) {
    focusPane(paneId);
  } else if (originalActivePaneId) {
    // Cursor moved off all panes — return focus to wherever the user was
    // before the drag started.
    focusPane(originalActivePaneId);
  }
}

async function dropPathsToPane(paneId: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const pane = findPaneById(paneId);
  if (!pane) return;
  const active = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
  if (!active || !isTerminalSurface(active)) return;
  if (active.ptyId < 0) return;

  const imagePaths: string[] = [];
  const textParts: string[] = [];
  for (const p of paths) {
    if (isImageFile(p)) imagePaths.push(p);
    else textParts.push(shellEscape(p));
  }

  if (imagePaths.length > 0) {
    try {
      await writeImage(imagePaths[0]!);
    } catch (e) {
      console.warn("Failed to write image to clipboard:", e);
      return;
    }
  }

  if (textParts.length > 0) {
    void invoke("write_pty", {
      ptyId: active.ptyId,
      data: textParts.join(" ") + " ",
    });
  } else if (imagePaths.length > 0) {
    // Image is on clipboard; \x16 is what Claude Code CLI interprets as a
    // paste, matching the manual Ctrl+V path.
    void invoke("write_pty", { ptyId: active.ptyId, data: "\x16" });
  }
}

/**
 * Install the global Tauri drag-drop router. Returns a disposer that
 * removes all listeners. Call once from App.svelte's onMount.
 */
export async function initDragDropPaneRouter(): Promise<() => void> {
  const unlistenEnter = await listen<{
    paths: string[];
    position: { x: number; y: number };
  }>("tauri://drag-enter", (event) => {
    ensureSession();
    const paneId = paneIdAtPoint(
      event.payload.position.x,
      event.payload.position.y,
    );
    if (paneId) focusPane(paneId);
  });

  const unlistenOver = await listen<{
    position: { x: number; y: number };
  }>("tauri://drag-over", (event) => {
    handleHoverPaneId(
      paneIdAtPoint(event.payload.position.x, event.payload.position.y),
    );
  });

  const unlistenLeave = await listen("tauri://drag-leave", () => {
    endSession(true);
  });

  const unlistenDrop = await listen<{
    paths: string[];
    position: { x: number; y: number };
  }>("tauri://drag-drop", (event) => {
    const paneId = paneIdAtPoint(
      event.payload.position.x,
      event.payload.position.y,
    );
    if (paneId) {
      focusPane(paneId);
      void dropPathsToPane(paneId, event.payload.paths);
      endSession(false);
    } else {
      endSession(true);
    }
  });

  return () => {
    unlistenEnter();
    unlistenOver();
    unlistenLeave();
    unlistenDrop();
  };
}
