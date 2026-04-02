/**
 * Horizontal tab bar — shows panes within the active workspace
 * Similar to browser tabs or cmux surfaces
 */

import { TerminalManager, type Workspace, type Pane } from "./terminal-manager";
import { showContextMenu, type MenuItem } from "./context-menu";

export class TabBar {
  private container: HTMLElement;
  private manager: TerminalManager;
  private tabsRow: HTMLElement;

  constructor(container: HTMLElement, manager: TerminalManager) {
    this.container = container;
    this.manager = manager;

    this.container.style.cssText = `
      height: 36px; background: #111; border-bottom: 1px solid #222;
      display: flex; align-items: center; padding: 0 4px;
      gap: 2px; overflow-x: auto; overflow-y: hidden;
      flex-shrink: 0; user-select: none;
    `;

    // Scrollable tab row
    this.tabsRow = document.createElement("div");
    this.tabsRow.style.cssText = `
      display: flex; align-items: center; gap: 2px;
      flex: 1; overflow-x: auto; min-width: 0;
    `;
    // Hide scrollbar
    this.tabsRow.style.scrollbarWidth = "none";

    // Add pane button
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    addBtn.title = "New pane (⌘D)";
    addBtn.style.cssText = `
      background: none; border: none; color: #555; cursor: pointer;
      font-size: 18px; padding: 2px 8px; border-radius: 4px;
      flex-shrink: 0; line-height: 1;
    `;
    addBtn.addEventListener("mouseenter", () => { addBtn.style.color = "#e0e0e0"; });
    addBtn.addEventListener("mouseleave", () => { addBtn.style.color = "#555"; });
    addBtn.addEventListener("click", () => { manager.splitPane("right"); });

    this.container.appendChild(this.tabsRow);
    this.container.appendChild(addBtn);

    manager.onChange(() => this.refresh());
  }

  refresh() {
    this.tabsRow.innerHTML = "";
    const ws = this.manager.activeWorkspace;
    if (!ws) return;

    ws.panes.forEach((pane, idx) => {
      const tab = this.createTab(ws, pane, idx);
      this.tabsRow.appendChild(tab);
    });
  }

  private createTab(ws: Workspace, pane: Pane, idx: number): HTMLElement {
    const isActive = pane.id === ws.activePaneId;

    const tab = document.createElement("div");
    tab.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 6px 6px 0 0;
      cursor: pointer; font-size: 12px; white-space: nowrap;
      min-width: 80px; max-width: 200px;
      background: ${isActive ? "#1a1a2e" : "transparent"};
      color: ${isActive ? "#e0e0e0" : "#666"};
      border-bottom: 2px solid ${isActive ? "#e85d04" : "transparent"};
      transition: background 0.1s;
    `;

    // Notification dot
    if (pane.hasUnread) {
      const dot = document.createElement("span");
      dot.style.cssText = `
        width: 6px; height: 6px; border-radius: 50%;
        background: #3b82f6; flex-shrink: 0;
      `;
      tab.appendChild(dot);
    }

    // Title
    const title = document.createElement("span");
    title.textContent = pane.title || `Shell ${idx + 1}`;
    title.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis;";
    tab.appendChild(title);

    // Close button
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      color: #555; font-size: 14px; line-height: 1;
      padding: 0 2px; border-radius: 3px; cursor: pointer;
      visibility: ${isActive ? "visible" : "hidden"};
    `;
    closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = "#ef4444"; });
    closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = "#555"; });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      ws.activePaneId = pane.id;
      this.manager.closeActivePane();
    });
    tab.appendChild(closeBtn);

    // Show close on hover
    tab.addEventListener("mouseenter", () => {
      if (!isActive) tab.style.background = "#151515";
      closeBtn.style.visibility = "visible";
    });
    tab.addEventListener("mouseleave", () => {
      if (!isActive) tab.style.background = "transparent";
      if (!isActive) closeBtn.style.visibility = "hidden";
    });

    // Click to focus
    tab.addEventListener("click", () => {
      ws.activePaneId = pane.id;
      pane.hasUnread = false;
      pane.terminal.focus();
      this.manager.notify();
    });

    // Right-click context menu
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const items: MenuItem[] = [
        {
          label: "Split Right",
          shortcut: "⌘D",
          action: () => {
            ws.activePaneId = pane.id;
            this.manager.splitPane("right");
          },
        },
        {
          label: "Split Down",
          shortcut: "⇧⌘D",
          action: () => {
            ws.activePaneId = pane.id;
            this.manager.splitPane("down");
          },
        },
        { label: "", action: () => {}, separator: true },
        {
          label: "Close Pane",
          shortcut: "⌘W",
          danger: true,
          action: () => {
            ws.activePaneId = pane.id;
            this.manager.closeActivePane();
          },
        },
      ];
      showContextMenu(e.clientX, e.clientY, items);
    });

    return tab;
  }
}
