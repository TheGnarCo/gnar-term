import { TerminalManager, type Workspace } from "./terminal-manager";
import { showContextMenu, type MenuItem } from "./context-menu";
import { theme } from "./theme";

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
      color: ${theme.fgMuted}; text-transform: uppercase; letter-spacing: 0.5px;
      border-bottom: 1px solid ${theme.border}; display: flex; align-items: center;
      justify-content: space-between;
    `;
    header.innerHTML = `<span>🤙 GnarTerm</span>`;

    const addButton = document.createElement("button");
    addButton.textContent = "+";
    addButton.title = "New workspace (⌘N)";
    addButton.style.cssText = `
      background: none; border: 1px solid ${theme.border}; color: ${theme.fgMuted};
      border-radius: 4px; width: 24px; height: 24px; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
    `;
    addButton.addEventListener("click", () => {
      manager.createWorkspace(`Workspace ${manager.workspaces.length + 1}`);
    });
    addButton.addEventListener("mouseenter", () => { addButton.style.borderColor = theme.fgMuted; });
    addButton.addEventListener("mouseleave", () => { addButton.style.borderColor = theme.border; });
    header.appendChild(addButton);

    this.workspaceList = document.createElement("div");
    this.workspaceList.style.cssText = "flex: 1; overflow-y: auto; padding: 4px 0;";

    container.appendChild(header);
    container.appendChild(this.workspaceList);

    manager.onChange(() => this.refresh());
  }

  refresh() {
    this.workspaceList.innerHTML = "";
    this.manager.workspaces.forEach((ws, idx) => {
      this.workspaceList.appendChild(this.createWorkspaceItem(ws, idx));
    });
  }

  private createWorkspaceItem(ws: Workspace, idx: number): HTMLElement {
    const isActive = idx === this.manager.activeWorkspaceIdx;
    const allSurfaces = this.manager.getAllSurfaces(ws);
    const hasUnread = allSurfaces.some((s) => s.hasUnread);
    const paneCount = ws.panes.length;
    const surfaceCount = allSurfaces.length;
    const latestNotification = allSurfaces.find((s) => s.notification)?.notification;

    const item = document.createElement("div");
    item.style.cssText = `
      margin: 2px 8px; border-radius: 6px; overflow: hidden;
      background: ${isActive ? theme.bgActive : "transparent"};
      border-left: 3px solid ${isActive ? theme.accent : "transparent"};
    `;

    // Header row
    const headerRow = document.createElement("div");
    headerRow.style.cssText = `
      padding: 8px 12px; cursor: pointer; display: flex;
      align-items: center; gap: 8px;
    `;
    headerRow.addEventListener("mouseenter", () => {
      if (!isActive) item.style.background = theme.bgHighlight;
    });
    headerRow.addEventListener("mouseleave", () => {
      item.style.background = isActive ? theme.bgActive : "transparent";
    });

    // Name
    const name = document.createElement("span");
    name.textContent = ws.name;
    name.style.cssText = `
      font-weight: ${isActive ? "600" : "400"};
      color: ${isActive ? theme.fg : theme.fgMuted};
      font-size: 13px; flex: 1; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    `;
    headerRow.appendChild(name);

    // Counts
    const meta = document.createElement("span");
    const parts: string[] = [];
    if (paneCount > 1) parts.push(`${paneCount}p`);
    if (surfaceCount > 1) parts.push(`${surfaceCount}s`);
    if (parts.length > 0) {
      meta.textContent = parts.join(" ");
      meta.style.cssText = `font-size: 10px; color: ${theme.fgDim}; background: ${theme.bgSurface}; padding: 1px 5px; border-radius: 8px;`;
      headerRow.appendChild(meta);
    }

    // Unread badge
    if (hasUnread) {
      const badge = document.createElement("span");
      badge.style.cssText = `width: 8px; height: 8px; border-radius: 50%; background: ${theme.notify}; flex-shrink: 0;`;
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

    // Notification preview
    if (latestNotification) {
      const notif = document.createElement("div");
      notif.style.cssText = `padding: 2px 12px 6px; font-size: 11px; color: ${theme.notify}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
      notif.textContent = `💬 ${latestNotification}`;
      item.appendChild(notif);
    }

    return item;
  }

  private showWorkspaceContextMenu(x: number, y: number, ws: Workspace, idx: number) {
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        shortcut: "⇧⌘R",
        action: () => {
          const name = prompt("Workspace name:", ws.name);
          if (name) { ws.name = name; this.refresh(); }
        },
      },
      {
        label: "New Surface",
        shortcut: "⌘T",
        action: () => {
          this.manager.switchWorkspace(idx);
          this.manager.newSurface();
        },
      },
      {
        label: "Split Right",
        shortcut: "⌘D",
        action: () => {
          this.manager.switchWorkspace(idx);
          this.manager.splitPane("right");
        },
      },
      {
        label: "Split Down",
        shortcut: "⇧⌘D",
        action: () => {
          this.manager.switchWorkspace(idx);
          this.manager.splitPane("down");
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
}
