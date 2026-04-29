/**
 * App-level keyboard shortcut dispatch.
 *
 * Order of precedence:
 *   1. command-palette registered shortcuts (core + extension commands)
 *   2. workspace-action registered shortcuts (extension toolbars)
 *   3. hardcoded core shortcuts handled here — these reference component
 *      refs or stores that don't fit the command-palette contract
 *      (e.g. focusing component-owned DOM, activating the focused pane's
 *      xterm before clearing its scrollback).
 */
import { get } from "svelte/store";
import {
  commandPaletteOpen,
  findBarVisible,
  primarySidebarVisible,
} from "../stores/ui";
import {
  workspaces,
  activeSurface,
  activeWorkspaceIdx,
  activePseudoWorkspaceId,
} from "../stores/workspace";
import { rootRowOrder } from "../stores/root-row-order";
import { isTerminalSurface } from "../types";
import { createWorkspace } from "./workspace-service";
import {
  flashFocusedPane,
  focusDirection,
  togglePaneZoom,
} from "./pane-service";
import {
  newSurfaceFromSidebar,
  nextSurface,
  prevSurface,
  selectSurfaceByNumber,
} from "./surface-service";
import { executeByShortcut } from "./command-registry";
import { executeWorkspaceActionByShortcut } from "./workspace-action-registry";
import { isMac, adjustFontSize, resetFontSize } from "../terminal-service";
import { renameActiveSurface } from "./surface-service";

/**
 * Context required by shortcuts that have to reach into component
 * instances bound in App.svelte. Keep this small — if a shortcut can be
 * expressed purely via stores or services, prefer that.
 */
export interface KeyboardShortcutContext {
  startRenameActiveWorkspace: () => void;
  findNext: () => void;
  findPrev: () => void;
}

export function handleAppKeydown(
  e: KeyboardEvent,
  ctx: KeyboardShortcutContext,
): void {
  if (executeByShortcut(e)) return;
  if (executeWorkspaceActionByShortcut(e)) return;

  const shift = e.shiftKey;
  const alt = e.altKey;
  const ctrl = e.ctrlKey;

  // macOS: bare Cmd+key quick-access shortcuts not covered by the
  // command palette (the palette uses ⇧⌘ for most entries).
  if (isMac && e.metaKey && !shift && !alt) {
    const cmdShortcuts: Record<string, () => void> = {
      n: () => createWorkspace(`Workspace ${get(workspaces).length + 1}`),
      t: () => newSurfaceFromSidebar(),
      b: () => primarySidebarVisible.update((v) => !v),
      k: () => {
        const s = get(activeSurface);
        if (s && isTerminalSurface(s)) s.terminal.clear();
      },
      p: () => commandPaletteOpen.update((v) => !v),
      f: () => findBarVisible.update((v) => !v),
      r: () => renameActiveSurface(),
      g: () => {
        findBarVisible.set(true);
        ctx.findNext();
      },
      "=": () => adjustFontSize(1),
      "+": () => adjustFontSize(1),
      "-": () => adjustFontSize(-1),
      "0": () => resetFontSize(),
    };
    const handler = cmdShortcuts[e.key];
    if (handler) {
      e.preventDefault();
      handler();
      return;
    }

    // ⌘1-9: select nth root row in the primary sidebar
    if (e.key >= "1" && e.key <= "9") {
      const n = parseInt(e.key) - 1;
      const row = get(rootRowOrder)[n];
      if (!row) return;
      e.preventDefault();
      if (row.kind === "workspace") {
        const idx = get(workspaces).findIndex((ws) => ws.id === row.id);
        if (idx >= 0) {
          activeWorkspaceIdx.set(idx);
          activePseudoWorkspaceId.set(null);
        }
      } else if (row.kind === "pseudo-workspace") {
        activeWorkspaceIdx.set(-1);
        activePseudoWorkspaceId.set(row.id);
      }
      return;
    }
  }

  // Shortcuts that reference component bindings or aren't in the
  // command palette. Use Cmd (mac) or Ctrl+Shift (other).
  if ((isMac ? e.metaKey : ctrl) && shift && !alt) {
    const k = e.key.toLowerCase();
    if (k === "h") {
      e.preventDefault();
      flashFocusedPane();
      return;
    }
    if (k === "r") {
      e.preventDefault();
      ctx.startRenameActiveWorkspace();
      return;
    }
    if (k === "g") {
      e.preventDefault();
      findBarVisible.set(true);
      ctx.findPrev();
      return;
    }
    if (k === "p") {
      e.preventDefault();
      commandPaletteOpen.update((v) => !v);
      return;
    }
    // Shift+Cmd+Enter (mac) / Ctrl+Shift+Enter (Linux) — toggle pane zoom
    if (k === "enter") {
      e.preventDefault();
      const s = get(activeSurface);
      if (s) togglePaneZoom(s.id);
      return;
    }
    // Non-mac only: Ctrl+Shift+K/F mirror the mac Cmd bindings above.
    // Font size uses Ctrl+Shift+=/- for Linux/Windows.
    if (!isMac) {
      if (k === "k") {
        e.preventDefault();
        const s = get(activeSurface);
        if (s && isTerminalSurface(s)) s.terminal.clear();
        return;
      }
      if (k === "f") {
        e.preventDefault();
        findBarVisible.update((v) => !v);
        return;
      }
      if (k === "=" || k === "+") {
        e.preventDefault();
        adjustFontSize(1);
        return;
      }
      // Ctrl+Shift+- on Linux produces e.key === "_" (shifted minus)
      if (k === "-" || k === "_") {
        e.preventDefault();
        adjustFontSize(-1);
        return;
      }
      if (k === "0") {
        e.preventDefault();
        resetFontSize();
        return;
      }
    }
  }

  // macOS: Ctrl+number selects surfaces
  if (
    isMac &&
    ctrl &&
    !e.metaKey &&
    !shift &&
    !alt &&
    e.key >= "1" &&
    e.key <= "8"
  ) {
    e.preventDefault();
    selectSurfaceByNumber(parseInt(e.key));
    return;
  }
  if (isMac && ctrl && !e.metaKey && !shift && !alt && e.key === "9") {
    e.preventDefault();
    selectSurfaceByNumber(9);
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab
  if (ctrl && !alt && e.key === "Tab") {
    e.preventDefault();
    if (shift) prevSurface();
    else nextSurface();
    return;
  }

  // Alt+Cmd/Ctrl+arrows for pane navigation
  if (alt && (isMac ? e.metaKey : ctrl) && !shift) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusDirection("left");
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusDirection("right");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusDirection("up");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusDirection("down");
      return;
    }
  }

  if (e.key === "Escape" && get(findBarVisible)) {
    e.preventDefault();
    findBarVisible.set(false);
    return;
  }
}
