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

    // Title bar row — sits next to macOS traffic light buttons
    const header = document.createElement("div");
    header.setAttribute("data-tauri-drag-region", "");
    header.style.cssText = `
      height: 38px; padding: 0 6px 0 0; display: flex; align-items: center;
      justify-content: flex-end; gap: 2px;
      border-bottom: 1px solid ${theme.border};
      -webkit-app-region: drag;
    `;

    const createToolbarBtn = (svg: string, title: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.innerHTML = svg;
      btn.title = title;
      btn.style.cssText = `
        background: none; border: none; color: ${theme.fgMuted};
        border-radius: 4px; width: 26px; height: 26px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        padding: 0; -webkit-app-region: no-drag;
      `;
      btn.addEventListener("click", onClick);
      btn.addEventListener("mouseenter", () => { btn.style.background = theme.bgHighlight; btn.style.color = theme.fg; });
      btn.addEventListener("mouseleave", () => { btn.style.background = "none"; btn.style.color = theme.fgMuted; });
      return btn;
    };

    // Sidebar toggle
    const sidebarToggleSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="12" rx="1.5"/><line x1="5.5" y1="2" x2="5.5" y2="14"/></svg>`;
    header.appendChild(createToolbarBtn(sidebarToggleSvg, "Hide Sidebar (⌘B)", () => {
      container.style.display = "none";
      const btn = document.getElementById("sidebar-toggle");
      if (btn) btn.style.display = "flex";
    }));

    // Split pane button
    const splitSvg = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="1.5"/><line x1="7" y1="1" x2="7" y2="13"/></svg>`;
    header.appendChild(createToolbarBtn(splitSvg, "Split Pane (⌘D)", () => {
      manager.splitPane("horizontal");
    }));

    // Add workspace button
    const addSvg = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/></svg>`;
    header.appendChild(createToolbarBtn(addSvg, "New workspace (⌘N)", () => {
      manager.createWorkspace(`Workspace ${manager.workspaces.length + 1}`);
    }));

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
    const paneCount = this.manager.getAllPanes(ws.splitRoot).length;
    const surfaceCount = allSurfaces.length;
    const latestNotification = allSurfaces.find((s) => s.notification)?.notification;

    const item = document.createElement("div");
    item.draggable = true;
    item.style.cssText = `
      margin: 2px 8px; border-radius: 6px; overflow: hidden;
      background: ${isActive ? theme.bgActive : "transparent"};
      border-left: 3px solid ${isActive ? theme.accent : "transparent"};
      transition: margin 0.15s, opacity 0.15s;
    `;

    // Drag and Drop reordering
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", idx.toString());
      item.style.opacity = "0.5";
    });
    item.addEventListener("dragend", () => {
      item.style.opacity = "1";
      this.refresh(); // Clear any drop styling
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      item.style.marginTop = "24px"; // Leave gap for drop
    });
    item.addEventListener("dragleave", () => {
      item.style.marginTop = "2px";
    });
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      item.style.marginTop = "2px";
      const fromIdx = parseInt(e.dataTransfer?.getData("text/plain") || "-1", 10);
      if (fromIdx >= 0 && fromIdx !== idx) {
        // Reorder array
        const wsToMove = this.manager.workspaces.splice(fromIdx, 1)[0];
        
        // Adjust destination index if we removed from before it
        const toIdx = fromIdx < idx ? idx - 1 : idx;
        this.manager.workspaces.splice(toIdx, 0, wsToMove);
        
        // Update active index if it moved
        if (this.manager.activeWorkspaceIdx === fromIdx) {
          this.manager.activeWorkspaceIdx = toIdx;
        } else if (this.manager.activeWorkspaceIdx > fromIdx && this.manager.activeWorkspaceIdx <= toIdx) {
          this.manager.activeWorkspaceIdx--;
        } else if (this.manager.activeWorkspaceIdx < fromIdx && this.manager.activeWorkspaceIdx >= toIdx) {
          this.manager.activeWorkspaceIdx++;
        }
        
        this.refresh();
      }
    });

    // Header row
    const headerRow = document.createElement("div");
    headerRow.style.cssText = `
      padding: 8px 12px; cursor: pointer; display: flex;
      align-items: center; gap: 8px;
    `;
    // Name container
    const nameContainer = document.createElement("div");
    nameContainer.style.cssText = "flex: 1; overflow: hidden; display: flex; align-items: center;";
    
    const name = document.createElement("span");
    name.textContent = ws.name;
    name.style.cssText = `
      font-weight: ${isActive ? "600" : "400"};
      color: ${isActive ? theme.fg : theme.fgMuted};
      font-size: 13px; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap;
      outline: none; padding: 2px 4px; margin-left: -4px; border-radius: 4px;
    `;
    nameContainer.appendChild(name);
    headerRow.appendChild(nameContainer);

    // Make rename accessible from outside
    (item as any).startRename = () => {
      name.contentEditable = "true";
      name.style.background = theme.bgSurface;
      name.style.border = `1px solid ${theme.borderActive}`;
      name.focus();
      
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(name);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const finishRename = () => {
        name.contentEditable = "false";
        name.style.background = "transparent";
        name.style.border = "none";
        const newName = name.textContent?.trim();
        if (newName && newName !== ws.name) {
          ws.name = newName;
          this.refresh();
        } else {
          name.textContent = ws.name; // revert
        }
      };

      name.addEventListener("blur", finishRename, { once: true });
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          name.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          name.textContent = ws.name; // revert
          name.blur();
        }
      });
    };

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

    // Close button (visible on hover)
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "×";
    closeBtn.title = "Close Workspace (⇧⌘W)";
    closeBtn.style.cssText = `
      color: ${theme.fgDim}; font-size: 14px; cursor: pointer;
      opacity: 0; transition: opacity 0.15s;
      padding: 0 2px; flex-shrink: 0;
    `;
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.manager.workspaces.length > 1) {
        this.manager.switchWorkspace(idx);
        this.manager.closeActiveWorkspace();
      }
    });
    closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = theme.danger; });
    closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = theme.fgDim; });
    headerRow.appendChild(closeBtn);

    // Show close button on hover
    headerRow.addEventListener("mouseenter", () => {
      closeBtn.style.opacity = "1";
      if (!isActive) item.style.background = theme.bgHighlight;
    });
    headerRow.addEventListener("mouseleave", () => {
      closeBtn.style.opacity = "0";
      item.style.background = isActive ? theme.bgActive : "transparent";
    });

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
          const item = this.workspaceList.children[idx] as any;
          if (item && item.startRename) {
            item.startRename();
          }
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
          this.manager.splitPane("horizontal");
        },
      },
      {
        label: "Split Down",
        shortcut: "⇧⌘D",
        action: () => {
          this.manager.switchWorkspace(idx);
          this.manager.splitPane("vertical");
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Other Workspaces",
        disabled: this.manager.workspaces.length <= 1,
        action: () => {
          let adjustedIdx = idx;
          for (let i = this.manager.workspaces.length - 1; i >= 0; i--) {
            if (i !== adjustedIdx) {
              this.manager.switchWorkspace(i);
              this.manager.closeActiveWorkspace();
              if (i < adjustedIdx) adjustedIdx--;
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
