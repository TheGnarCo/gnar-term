import { TerminalManager, type Workspace } from "./terminal-manager";

export class Sidebar {
  private container: HTMLElement;
  private manager: TerminalManager;
  private workspaceList: HTMLElement;
  private addButton: HTMLElement;

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

    // Add workspace button
    this.addButton = document.createElement("button");
    this.addButton.textContent = "+";
    this.addButton.style.cssText = `
      background: none; border: 1px solid #333; color: #888;
      border-radius: 4px; width: 24px; height: 24px; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
    `;
    this.addButton.addEventListener("click", () => {
      const name = `Workspace ${manager.workspaces.length + 1}`;
      manager.createWorkspace(name);
      this.refresh();
    });
    header.appendChild(this.addButton);

    // Workspace list
    this.workspaceList = document.createElement("div");
    this.workspaceList.style.cssText = "flex: 1; overflow-y: auto; padding: 8px 0;";

    container.appendChild(header);
    container.appendChild(this.workspaceList);

    // Auto-refresh on terminal changes
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
      padding: 8px 16px; cursor: pointer; display: flex;
      flex-direction: column; gap: 2px; transition: background 0.1s;
      background: ${isActive ? "#1a1a2e" : "transparent"};
      border-left: 3px solid ${isActive ? "#e85d04" : "transparent"};
    `;

    item.addEventListener("mouseenter", () => {
      if (!isActive) item.style.background = "#151515";
    });
    item.addEventListener("mouseleave", () => {
      if (!isActive) item.style.background = "transparent";
    });

    // Workspace name + notification badge
    const nameRow = document.createElement("div");
    nameRow.style.cssText = "display: flex; align-items: center; gap: 8px;";

    const name = document.createElement("span");
    name.textContent = ws.name;
    name.style.cssText = `
      font-weight: ${isActive ? "600" : "400"};
      color: ${isActive ? "#e0e0e0" : "#888"};
      font-size: 13px; flex: 1; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
    `;

    nameRow.appendChild(name);

    // Notification badge
    if (hasUnread) {
      const badge = document.createElement("span");
      badge.style.cssText = `
        width: 8px; height: 8px; border-radius: 50%;
        background: #3b82f6; flex-shrink: 0;
      `;
      nameRow.appendChild(badge);
    }

    item.appendChild(nameRow);

    // Pane count + latest notification
    const meta = document.createElement("div");
    meta.style.cssText = "font-size: 11px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

    const paneCount = ws.panes.length;
    const latestNotification = ws.panes.find((p) => p.notification)?.notification;
    meta.textContent = latestNotification
      ? `${paneCount} pane${paneCount > 1 ? "s" : ""} · ${latestNotification}`
      : `${paneCount} pane${paneCount > 1 ? "s" : ""}`;

    item.appendChild(meta);

    item.addEventListener("click", () => {
      this.manager.switchWorkspace(idx);
      this.refresh();
    });

    return item;
  }
}
