/**
 * Keyboard shortcut handler — maps key combos to application actions.
 *
 * Extracted from App.svelte to keep the component focused on layout.
 * Each action is a callback passed in via the `actions` object.
 *
 * Cross-platform: macOS uses Cmd (metaKey), Linux/Windows uses Ctrl+Shift
 * (to avoid conflicts with terminal Ctrl shortcuts like Ctrl+C, Ctrl+D, etc.).
 */

import { isMac } from "./terminal-service";

/** Platform-aware modifier check: Cmd on macOS, Ctrl+Shift on Linux/Windows. */
export const isModifier = (e: KeyboardEvent): boolean =>
  isMac ? e.metaKey : e.ctrlKey && e.shiftKey;

export interface KeybindingActions {
  createWorkspace: () => void;
  newSurface: () => void;
  splitHorizontal: () => void;
  splitVertical: () => void;
  closeWorkspace: () => void;
  switchWorkspace: (idx: number) => void;
  selectSurface: (num: number) => void;
  nextSurface: () => void;
  prevSurface: () => void;
  toggleSidebar: () => void;
  clearTerminal: () => void;
  focusDirection: (dir: "left" | "right" | "up" | "down") => void;
  togglePaneZoom: () => void;
  flashFocusedPane: () => void;
  startRename: () => void;
  toggleCommandPalette: () => void;
  toggleFindBar: () => void;
  findNext: () => void;
  findPrev: () => void;
  closeFindBar: () => void;
  goHome: () => void;
  openSettings: () => void;
  escapeBack: () => void;
  workspaceCount: () => number;
  activeIdx: () => number;
  findBarVisible: () => boolean;
  commandPaletteOpen: () => boolean;
  currentView: () => string;
}

export function handleKeydown(
  e: KeyboardEvent,
  actions: KeybindingActions,
): void {
  // Platform-aware modifier: Cmd on macOS, Ctrl+Shift on Linux/Windows.
  // On Linux, shift is consumed by the modifier itself, so "mod" means
  // Cmd on macOS and Ctrl+Shift on Linux — no extra shift needed.
  const mod = isModifier(e);

  // "mod + shift" — on macOS this is Cmd+Shift, on Linux Ctrl+Shift is already
  // the base modifier so there's no separate "shift" layer. We use the same
  // Ctrl+Shift combo for both plain and shifted shortcuts on Linux, and
  // disambiguate by key (lowercase = plain, uppercase/special = shifted).
  //
  // To distinguish "Cmd+D" from "Cmd+Shift+D" on macOS we check e.shiftKey.
  // On Linux both map to Ctrl+Shift+<key> — the key value itself differs
  // (e.g., "d" vs "D") which gives us the distinction we need.
  const shift = e.shiftKey;
  const alt = e.altKey;
  const ctrl = e.ctrlKey;

  // On macOS: "mod only" = Cmd, no Shift, no Alt
  // On Linux: "mod only" = Ctrl+Shift, no Alt (shift is part of the modifier)
  const modOnly = mod && (isMac ? !shift : true) && !alt;
  // "mod + shift" — on macOS: Cmd+Shift, on Linux: Ctrl+Shift (same as modOnly)
  const modShift = mod && shift && !alt;

  if (modOnly && e.key === "n") {
    e.preventDefault();
    actions.createWorkspace();
    return;
  }
  if (modOnly && e.key === "t") {
    e.preventDefault();
    actions.newSurface();
    return;
  }
  if (modOnly && e.key === "d") {
    e.preventDefault();
    actions.splitHorizontal();
    return;
  }
  if (modShift && (e.key === "d" || e.key === "D")) {
    e.preventDefault();
    actions.splitVertical();
    return;
  }
  if (modShift && (e.key === "w" || e.key === "W")) {
    e.preventDefault();
    actions.closeWorkspace();
    return;
  }
  // Cmd+1-9 (macOS) / Ctrl+Shift+1-9 (Linux): switch workspace
  if (modOnly && !ctrl && e.key >= "1" && e.key <= "8") {
    // On Linux modOnly already requires ctrl, so !ctrl would never match.
    // Use a platform-aware check instead.
    if (isMac && ctrl) {
      // skip — Ctrl+Cmd+number is not this binding
    } else {
      e.preventDefault();
      actions.switchWorkspace(parseInt(e.key) - 1);
      return;
    }
  }
  if (modOnly && !ctrl && e.key === "9") {
    if (isMac && ctrl) {
      // skip
    } else {
      e.preventDefault();
      actions.switchWorkspace(actions.workspaceCount() - 1);
      return;
    }
  }
  // Ctrl+1-9 (both platforms): select surface tab
  if (ctrl && !e.metaKey && !shift && !alt && e.key >= "1" && e.key <= "8") {
    e.preventDefault();
    actions.selectSurface(parseInt(e.key));
    return;
  }
  if (ctrl && !e.metaKey && !shift && !alt && e.key === "9") {
    e.preventDefault();
    actions.selectSurface(9);
    return;
  }
  // Ctrl+Cmd+]/[ (macOS) / Alt+Shift+]/[ (Linux): cycle workspaces
  if (
    isMac ? ctrl && e.metaKey && e.key === "]" : alt && shift && e.key === "]"
  ) {
    e.preventDefault();
    actions.switchWorkspace(
      (actions.activeIdx() + 1) % actions.workspaceCount(),
    );
    return;
  }
  if (
    isMac ? ctrl && e.metaKey && e.key === "[" : alt && shift && e.key === "["
  ) {
    e.preventDefault();
    actions.switchWorkspace(
      (actions.activeIdx() - 1 + actions.workspaceCount()) %
        actions.workspaceCount(),
    );
    return;
  }
  // Cmd+Shift+]/[ (macOS) / Ctrl+Shift+]/[ (Linux): next/prev surface
  if (modShift && (e.key === "]" || e.key === "}")) {
    e.preventDefault();
    actions.nextSurface();
    return;
  }
  if (modShift && (e.key === "[" || e.key === "{")) {
    e.preventDefault();
    actions.prevSurface();
    return;
  }
  // Ctrl+Tab / Ctrl+Shift+Tab: cycle surfaces (both platforms)
  if (ctrl && !e.metaKey && !alt && e.key === "Tab") {
    e.preventDefault();
    if (shift) actions.prevSurface();
    else actions.nextSurface();
    return;
  }
  if (modOnly && e.key === "b") {
    e.preventDefault();
    actions.toggleSidebar();
    return;
  }
  if (modOnly && e.key === "k") {
    e.preventDefault();
    actions.clearTerminal();
    return;
  }
  // Alt+Cmd+Arrow (macOS) / Alt+Shift+Arrow (Linux): pane navigation
  if (alt && mod && e.key === "ArrowLeft") {
    e.preventDefault();
    actions.focusDirection("left");
    return;
  }
  if (alt && mod && e.key === "ArrowRight") {
    e.preventDefault();
    actions.focusDirection("right");
    return;
  }
  if (alt && mod && e.key === "ArrowUp") {
    e.preventDefault();
    actions.focusDirection("up");
    return;
  }
  if (alt && mod && e.key === "ArrowDown") {
    e.preventDefault();
    actions.focusDirection("down");
    return;
  }
  if (modShift && e.key === "Enter") {
    e.preventDefault();
    actions.togglePaneZoom();
    return;
  }
  if (modShift && (e.key === "h" || e.key === "H")) {
    e.preventDefault();
    actions.goHome();
    return;
  }
  if (modShift && (e.key === "r" || e.key === "R")) {
    e.preventDefault();
    actions.startRename();
    return;
  }
  if (modOnly && e.key === "p") {
    e.preventDefault();
    actions.toggleCommandPalette();
    return;
  }
  if (modOnly && e.key === "f") {
    e.preventDefault();
    actions.toggleFindBar();
    return;
  }
  if (modOnly && e.key === "g") {
    e.preventDefault();
    actions.findNext();
    return;
  }
  if (modShift && (e.key === "g" || e.key === "G")) {
    e.preventDefault();
    actions.findPrev();
    return;
  }
  if (e.key === "Escape" && actions.findBarVisible()) {
    e.preventDefault();
    actions.closeFindBar();
    return;
  }
  // Cmd+, (macOS) / Ctrl+, (Linux): open settings
  if (
    (isMac ? e.metaKey && !e.shiftKey && !e.altKey : e.ctrlKey && !e.altKey) &&
    e.key === ","
  ) {
    e.preventDefault();
    actions.openSettings();
    return;
  }
  // Escape: go back from non-workspace views (when no overlay is open)
  if (
    e.key === "Escape" &&
    !actions.findBarVisible() &&
    !actions.commandPaletteOpen()
  ) {
    const view = actions.currentView();
    if (
      view === "settings" ||
      view === "project-settings" ||
      view === "project-dashboard" ||
      view === "project"
    ) {
      e.preventDefault();
      actions.escapeBack();
      return;
    }
  }
}
