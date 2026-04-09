/**
 * Keyboard shortcut handler — maps key combos to application actions.
 *
 * Extracted from App.svelte to keep the component focused on layout.
 * Each action is a callback passed in via the `actions` object.
 */

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
  workspaceCount: () => number;
  activeIdx: () => number;
  findBarVisible: () => boolean;
}

export function handleKeydown(
  e: KeyboardEvent,
  actions: KeybindingActions,
): void {
  const cmd = e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const ctrl = e.ctrlKey;

  if (cmd && !shift && !alt && e.key === "n") {
    e.preventDefault();
    actions.createWorkspace();
    return;
  }
  if (cmd && !shift && !alt && e.key === "t") {
    e.preventDefault();
    actions.newSurface();
    return;
  }
  if (cmd && !shift && !alt && e.key === "d") {
    e.preventDefault();
    actions.splitHorizontal();
    return;
  }
  if (cmd && shift && !alt && e.key === "d") {
    e.preventDefault();
    actions.splitVertical();
    return;
  }
  if (cmd && shift && !alt && e.key === "w") {
    e.preventDefault();
    actions.closeWorkspace();
    return;
  }
  if (cmd && !shift && !alt && !ctrl && e.key >= "1" && e.key <= "8") {
    e.preventDefault();
    actions.switchWorkspace(parseInt(e.key) - 1);
    return;
  }
  if (cmd && !shift && !alt && !ctrl && e.key === "9") {
    e.preventDefault();
    actions.switchWorkspace(actions.workspaceCount() - 1);
    return;
  }
  if (ctrl && !cmd && !shift && !alt && e.key >= "1" && e.key <= "8") {
    e.preventDefault();
    actions.selectSurface(parseInt(e.key));
    return;
  }
  if (ctrl && !cmd && !shift && !alt && e.key === "9") {
    e.preventDefault();
    actions.selectSurface(9);
    return;
  }
  if (ctrl && cmd && e.key === "]") {
    e.preventDefault();
    actions.switchWorkspace(
      (actions.activeIdx() + 1) % actions.workspaceCount(),
    );
    return;
  }
  if (ctrl && cmd && e.key === "[") {
    e.preventDefault();
    actions.switchWorkspace(
      (actions.activeIdx() - 1 + actions.workspaceCount()) %
        actions.workspaceCount(),
    );
    return;
  }
  if (cmd && shift && e.key === "]") {
    e.preventDefault();
    actions.nextSurface();
    return;
  }
  if (cmd && shift && e.key === "[") {
    e.preventDefault();
    actions.prevSurface();
    return;
  }
  if (ctrl && !cmd && !alt && e.key === "Tab") {
    e.preventDefault();
    if (shift) actions.prevSurface();
    else actions.nextSurface();
    return;
  }
  if (cmd && !shift && !alt && e.key === "b") {
    e.preventDefault();
    actions.toggleSidebar();
    return;
  }
  if (cmd && !shift && !alt && e.key === "k") {
    e.preventDefault();
    actions.clearTerminal();
    return;
  }
  if (alt && cmd && e.key === "ArrowLeft") {
    e.preventDefault();
    actions.focusDirection("left");
    return;
  }
  if (alt && cmd && e.key === "ArrowRight") {
    e.preventDefault();
    actions.focusDirection("right");
    return;
  }
  if (alt && cmd && e.key === "ArrowUp") {
    e.preventDefault();
    actions.focusDirection("up");
    return;
  }
  if (alt && cmd && e.key === "ArrowDown") {
    e.preventDefault();
    actions.focusDirection("down");
    return;
  }
  if (cmd && shift && e.key === "Enter") {
    e.preventDefault();
    actions.togglePaneZoom();
    return;
  }
  if (cmd && shift && e.key === "h") {
    e.preventDefault();
    actions.flashFocusedPane();
    return;
  }
  if (cmd && shift && e.key === "r") {
    e.preventDefault();
    actions.startRename();
    return;
  }
  if (cmd && !shift && !alt && e.key === "p") {
    e.preventDefault();
    actions.toggleCommandPalette();
    return;
  }
  if (cmd && !shift && !alt && e.key === "f") {
    e.preventDefault();
    actions.toggleFindBar();
    return;
  }
  if (cmd && !shift && !alt && e.key === "g") {
    e.preventDefault();
    actions.findNext();
    return;
  }
  if (cmd && shift && !alt && e.key === "g") {
    e.preventDefault();
    actions.findPrev();
    return;
  }
  if (e.key === "Escape" && actions.findBarVisible()) {
    e.preventDefault();
    actions.closeFindBar();
    return;
  }
}
