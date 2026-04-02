import { TerminalManager, type Workspace, type Pane } from "./terminal-manager";
import { showContextMenu, type MenuItem } from "./context-menu";

export class Sidebar {
  private container: HTMLElement;
  private manager: TerminalManager;
  private workspaceList: HTMLElement;

  constructor(container: HTMLElement, manager: TerminalManager) {
    this.container = container;
    this.manager = manager;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 12px 16px; font-weight: 600; font-size: 14px;
      color: #888; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid #222; display: flex; align-items: center;
      justify-content: space-between;
    `;
    header.innerHTML = `<span>🤙 GnarTerm</span>`;

    const addButton = document.createElement("button");
    addButton.textContent = "+";
    addButton.title = "New workspace (Cmd+N)";
    addButton.style.cssText = `
      background: none; border: 1px solid #333; color: #888;
      border-radius: 4px; width: 24px; height: 24px; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
    `;
    addButton.addEventListener("click", () => {
      const name = `Workspace ${manager.workspaces.length + 1}`;
      manager.createWorkspace(name);
    });
    addButton.addEventListener("mouseenter", () => { addButton.style.borderColor = "#555"; });
    addButton.addEventListener("mouseleave", () => { addButton.style.borderColor = "#333"; });
    header.appendChild(addButton);

    // Workspace list
    this.workspaceList = document.createElement("div");
    this.workspaceList.style.cssText = "flex: 1; overflow-y: auto; padding: 4px 0;";

    container.appendChild(header);
    container.appendChild(this.workspaceList);

    // Auto-refresh on changes
    manager.onChange(() => this.refresh());
  }

  refresh() {
    this.workspaceList.innerHTML = "";

    this.manager.workspaces.forEach((ws, idx) => {
      const item = this.createWorkspaceItem(ws, idx);
      this.workspaceList.appendChild(item);
    });
  }

  private createWorkspaceItem(ws: Workspace, idx: number): HTMLElement {
    const isActive = idx === this.manager.activeWorkspaceIdx;
    const hasUnread = ws.panes.some((p) => p.hasUnread);

    const item = document.createElement("div");
    item.style.cssText = `
      margin: 2px 8px; border-radius: 6px; overflow: hidden;
      background: ${isActive ? "#1a1a2e" : "transparent"};
      border-left: 3px solid ${isActive ? "#e85d04" : "transparent"};
    `;

    // Workspace header row
    const headerRow = document.createElement("div");
    headerRow.style.cssText = `
      padding: 8px 12px; cursor: pointer; display: flex;
      align-items: center; gap: 8px;
    `;
    headerRow.addEventListener("mouseenter", () => {
      if (!isActive) item.style.background = "#151515";
    });
    headerRow.addEventListener("mouseleave", () => {
      if (!isActive) item.style.background = isActive ? "#1a1a2e" : "transparent";
    });

    // Workspace name
    const name = document.createElement("span");
    name.textContent = ws.name;
    name.style.cssText = `
      font-weight: ${isActive ? "600" : "400"};
      color: ${isActive ? "#e0e0e0" : "#888"};
      font-size: 13px; flex: 1; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    `;
    headerRow.appendChild(name);

    // Pane count badge
    const countBadge = document.createElement("span");
    countBadge.textContent = `${ws.panes.length}`;
    countBadge.style.cssText = `
      font-size: 10px; color: #555; background: #1a1a1a;
      padding: 1px 5px; border-radius: 8px;
    `;
    headerRow.appendChild(countBadge);

    // Notification badge
    if (hasUnread) {
      const badge = document.createElement("span");
      badge.style.cssText = `
        width: 8px; height: 8px; border-radius: 50%;
        background: #3b82f6; flex-shrink: 0;
      `;
      headerRow.appendChild(badge);
    }

    headerRow.addEventListener("click", () => {
      this.manager.switchWorkspace(idx);
    });

    headerRow.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showWorkspaceContextMenu(e.clientX, e.clientY, ws, idx);
    });

    item.appendChild(headerRow);

    // Pane list (only for active workspace)
    if (isActive && ws.panes.length > 1) {
      const paneList = document.createElement("div");
      paneList.style.cssText = "padding: 0 8px 6px 20px;";

      ws.panes.forEach((pane) => {
        const paneItem = this.createPaneItem(ws, pane);
        paneList.appendChild(paneItem);
      });

      item.appendChild(paneList);
    }

    // Latest notification preview
    const latestNotification = ws.panes.find((p) => p.notification)?.notification;
    if (latestNotification) {
      const notifPreview = document.createElement("div");
      notifPreview.style.cssText = `
        padding: 2px 12px 6px; font-size: 11px; color: #3b82f6;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      `;
      notifPreview.textContent = `💬 ${latestNotification}`;
      item.appendChild(notifPreview);
    }

    return item;
  }

  private createPaneItem(ws: Workspace, pane: Pane): HTMLElement {
    const isActive = pane.id === ws.activePaneId;

    const item = document.createElement("div");
    item.style.cssText = `
      padding: 3px 8px; cursor: pointer; font-size: 12px;
      color: ${isActive ? "#e0e0e0" : "#666"};
      border-radius: 3px; display: flex; align-items: center; gap: 6px;
      background: ${isActive ? "#222" : "transparent"};
    `;

    const icon = document.createElement("span");
    icon.textContent = "›";
    icon.style.cssText = `color: ${isActive ? "#e85d04" : "#444"}; font-weight: bold;`;

    const title = document.createElement("span");
    title.textContent = pane.title || "Shell";
    title.style.cssText = "flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

    item.appendChild(icon);
    item.appendChild(title);

    if (pane.hasUnread) {
      const dot = document.createElement("span");
      dot.style.cssText = "width: 6px; height: 6px; border-radius: 50%; background: #3b82f6;";
      item.appendChild(dot);
    }

    item.addEventListener("mouseenter", () => {
      if (!isActive) item.style.background = "#1a1a1a";
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = isActive ? "#222" : "transparent";
    });

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      ws.activePaneId = pane.id;
      pane.hasUnread = false;
      pane.terminal.focus();
      this.refresh();
    });

    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showPaneContextMenu(e.clientX, e.clientY, ws, pane);
    });

    return item;
  }

  private showWorkspaceContextMenu(x: number, y: number, ws: Workspace, idx: number) {
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        action: () => {
          const name = prompt("Workspace name:", ws.name);
          if (name) {
            ws.name = name;
            this.refresh();
          }
        },
      },
      {
        label: "New Pane",
        shortcut: "⌘D",
        action: () => {
          this.manager.switchWorkspace(idx);
          this.manager.splitPane("right");
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Other Workspaces",
        disabled: this.manager.workspaces.length <= 1,
        action: () => {
          for (let i = this.manager.workspaces.length - 1; i >= 0; i--) {
            if (i !== idx) {
              this.manager.switchWorkspace(i);
              this.manager.closeActiveWorkspace();
            }
          }
          this.manager.switchWorkspace(0);
        },
      },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: this.manager.workspaces.length <= 1,
        action: () => {
          this.manager.switchWorkspace(idx);
          this.manager.closeActiveWorkspace();
        },
      },
    ];
    showContextMenu(x, y, items);
  }

  private showPaneContextMenu(x: number, y: number, ws: Workspace, pane: Pane) {
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
        disabled: ws.panes.length <= 1,
        action: () => {
          ws.activePaneId = pane.id;
          this.manager.closeActivePane();
        },
      },
    ];
    showContextMenu(x, y, items);
  }
}
