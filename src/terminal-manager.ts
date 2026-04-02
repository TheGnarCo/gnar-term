import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export interface Pane {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  ptyId: number;
  notification?: string;
  hasUnread: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  activePaneId: string | null;
  element: HTMLElement;
}

let _id = 0;
function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

export class TerminalManager {
  workspaces: Workspace[] = [];
  activeWorkspaceIdx = -1;
  private container: HTMLElement;
  private onChangeCallbacks: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.setupPtyListener();
  }

  onChange(cb: () => void) {
    this.onChangeCallbacks.push(cb);
  }

  private notify() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }

  private async setupPtyListener() {
    // Listen for PTY output from Rust backend
    await listen<{ pty_id: number; data: number[] }>("pty-output", (event) => {
      const { pty_id, data } = event.payload;
      const bytes = new Uint8Array(data);
      // Find the pane with this pty_id
      for (const ws of this.workspaces) {
        const pane = ws.panes.find((p) => p.ptyId === pty_id);
        if (pane) {
          pane.terminal.write(bytes);
          break;
        }
      }
    });

    // Listen for notifications (OSC 9/99/777)
    await listen<{ pty_id: number; text: string }>("pty-notification", (event) => {
      const { pty_id, text } = event.payload;
      for (const ws of this.workspaces) {
        const pane = ws.panes.find((p) => p.ptyId === pty_id);
        if (pane) {
          pane.notification = text;
          pane.hasUnread = true;
          this.notify();
          break;
        }
      }
    });
  }

  get activeWorkspace(): Workspace | null {
    return this.workspaces[this.activeWorkspaceIdx] ?? null;
  }

  get activePane(): Pane | null {
    const ws = this.activeWorkspace;
    if (!ws) return null;
    return ws.panes.find((p) => p.id === ws.activePaneId) ?? null;
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const wsElement = document.createElement("div");
    wsElement.style.cssText = "flex: 1; display: flex; min-height: 0;";

    const ws: Workspace = {
      id: uid(),
      name,
      panes: [],
      activePaneId: null,
      element: wsElement,
    };

    this.workspaces.push(ws);
    this.switchWorkspace(this.workspaces.length - 1);

    // Auto-create first pane
    await this.addPane(ws);

    return ws;
  }

  private async addPane(ws: Workspace): Promise<Pane> {
    const element = document.createElement("div");
    element.style.cssText = "flex: 1; min-width: 0; min-height: 0; position: relative;";
    element.classList.add("pane");

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#264f78",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Spawn PTY via Tauri
    let ptyId: number;
    try {
      ptyId = await invoke<number>("spawn_pty", {
        cols: 80,
        rows: 24,
      });
    } catch (err) {
      console.error("Failed to spawn PTY:", err);
      ptyId = -1;
    }

    const pane: Pane = {
      id: uid(),
      terminal,
      fitAddon,
      element,
      ptyId,
      hasUnread: false,
    };

    ws.panes.push(pane);
    ws.activePaneId = pane.id;
    ws.element.appendChild(element);

    terminal.open(element);

    // Try WebGL renderer
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      console.warn("WebGL addon failed, falling back to canvas renderer");
    }

    fitAddon.fit();

    // Forward input to PTY
    terminal.onData((data) => {
      if (pane.ptyId >= 0) {
        invoke("write_pty", { ptyId: pane.ptyId, data });
      }
    });

    // Handle resize
    terminal.onResize(({ cols, rows }) => {
      if (pane.ptyId >= 0) {
        invoke("resize_pty", { ptyId: pane.ptyId, cols, rows });
      }
    });

    // Focus tracking
    element.addEventListener("click", () => {
      ws.activePaneId = pane.id;
      pane.hasUnread = false;
      terminal.focus();
      this.notify();
    });

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(element);

    terminal.focus();
    this.notify();
    return pane;
  }

  switchWorkspace(idx: number) {
    if (idx < 0 || idx >= this.workspaces.length) return;

    // Hide current
    if (this.activeWorkspaceIdx >= 0) {
      const prev = this.workspaces[this.activeWorkspaceIdx];
      prev.element.remove();
    }

    this.activeWorkspaceIdx = idx;
    const ws = this.workspaces[idx];
    this.container.appendChild(ws.element);

    // Focus active pane
    const active = ws.panes.find((p) => p.id === ws.activePaneId);
    if (active) {
      setTimeout(() => {
        active.fitAddon.fit();
        active.terminal.focus();
      }, 10);
    }

    this.notify();
  }

  async splitPane(direction: "right" | "down") {
    const ws = this.activeWorkspace;
    if (!ws) return;

    // For now, just add another pane in a flex layout
    if (direction === "right") {
      ws.element.style.flexDirection = "row";
    } else {
      ws.element.style.flexDirection = "column";
    }

    await this.addPane(ws);

    // Re-fit all panes
    ws.panes.forEach((p) => p.fitAddon.fit());
    this.notify();
  }

  closeActivePane() {
    const ws = this.activeWorkspace;
    if (!ws || ws.panes.length <= 1) return;

    const idx = ws.panes.findIndex((p) => p.id === ws.activePaneId);
    if (idx < 0) return;

    const pane = ws.panes[idx];
    pane.terminal.dispose();
    pane.element.remove();

    if (pane.ptyId >= 0) {
      invoke("kill_pty", { ptyId: pane.ptyId }).catch(() => {});
    }

    ws.panes.splice(idx, 1);
    ws.activePaneId = ws.panes[Math.min(idx, ws.panes.length - 1)]?.id ?? null;

    const active = ws.panes.find((p) => p.id === ws.activePaneId);
    if (active) {
      active.fitAddon.fit();
      active.terminal.focus();
    }

    this.notify();
  }

  closeActiveWorkspace() {
    if (this.workspaces.length <= 1) return;

    const ws = this.workspaces[this.activeWorkspaceIdx];
    ws.panes.forEach((p) => {
      p.terminal.dispose();
      if (p.ptyId >= 0) invoke("kill_pty", { ptyId: p.ptyId }).catch(() => {});
    });
    ws.element.remove();

    this.workspaces.splice(this.activeWorkspaceIdx, 1);
    this.switchWorkspace(Math.min(this.activeWorkspaceIdx, this.workspaces.length - 1));
    this.notify();
  }
}
