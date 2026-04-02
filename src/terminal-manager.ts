import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { theme, xtermTheme } from "./theme";
import "@xterm/xterm/css/xterm.css";

export interface Pane {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  ptyId: number;
  notification?: string;
  hasUnread: boolean;
  title: string;
}

export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  activePaneId: string | null;
  element: HTMLElement;
  splitDirection: "row" | "column";
}

let _id = 0;
function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

// Sensible fallback font stack
const FALLBACK_FONTS = 'Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';

let resolvedFontFamily = FALLBACK_FONTS;

// Detect the user's actual terminal font from their existing configs
// (Ghostty, Alacritty, Kitty, WezTerm, iTerm2)
async function detectFont(): Promise<string> {
  try {
    const font = await invoke<string>("detect_font");
    if (font) {
      console.log(`[gnar-term] Detected terminal font: ${font}`);
      return `"${font}", ${FALLBACK_FONTS}`;
    }
  } catch {
    // detect_font not available
  }
  console.log("[gnar-term] No terminal font config found, using system defaults");
  return FALLBACK_FONTS;
}

// Initialize font detection
detectFont().then((f) => { resolvedFontFamily = f; });

export class TerminalManager {
  workspaces: Workspace[] = [];
  activeWorkspaceIdx = -1;
  private container: HTMLElement;
  private onChangeCallbacks: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.setupListeners();
  }

  onChange(cb: () => void) {
    this.onChangeCallbacks.push(cb);
  }

  notify() {
    this.onChangeCallbacks.forEach((cb) => cb());
  }

  private async setupListeners() {
    // PTY output
    await listen<{ pty_id: number; data: number[] }>("pty-output", (event) => {
      const { pty_id, data } = event.payload;
      const bytes = new Uint8Array(data);
      for (const ws of this.workspaces) {
        const pane = ws.panes.find((p) => p.ptyId === pty_id);
        if (pane) {
          pane.terminal.write(bytes);
          break;
        }
      }
    });

    // PTY exit — close the pane
    await listen<{ pty_id: number }>("pty-exit", (event) => {
      const { pty_id } = event.payload;
      for (let wi = 0; wi < this.workspaces.length; wi++) {
        const ws = this.workspaces[wi];
        const paneIdx = ws.panes.findIndex((p) => p.ptyId === pty_id);
        if (paneIdx >= 0) {
          this.removePaneByIndex(wi, paneIdx);
          break;
        }
      }
    });

    // Notifications (OSC 9/99/777)
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
    wsElement.style.cssText = "flex: 1; display: flex; min-height: 0; min-width: 0;";

    const ws: Workspace = {
      id: uid(),
      name,
      panes: [],
      activePaneId: null,
      element: wsElement,
      splitDirection: "row",
    };

    this.workspaces.push(ws);
    this.switchWorkspace(this.workspaces.length - 1);
    await this.addPane(ws);

    return ws;
  }

  private async addPane(ws: Workspace): Promise<Pane> {
    const element = document.createElement("div");
    element.style.cssText = `
      flex: 1; min-width: 0; min-height: 0; position: relative;
      border: 1px solid ${theme.border}; margin: 1px;
    `;
    element.classList.add("pane");

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: resolvedFontFamily,
      theme: xtermTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Spawn PTY
    let ptyId: number;
    try {
      ptyId = await invoke<number>("spawn_pty", { cols: 80, rows: 24 });
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
      title: `Shell ${ws.panes.length + 1}`,
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

    // Track title changes
    terminal.onTitleChange((title) => {
      pane.title = title;
      this.notify();
    });

    // Focus tracking — highlight active pane
    element.addEventListener("mousedown", () => {
      this.setActivePane(ws, pane);
    });

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(element);

    terminal.focus();
    this.updatePaneBorders(ws);
    this.notify();
    return pane;
  }

  private setActivePane(ws: Workspace, pane: Pane) {
    ws.activePaneId = pane.id;
    pane.hasUnread = false;
    pane.terminal.focus();
    this.updatePaneBorders(ws);
    this.notify();
  }

  private updatePaneBorders(ws: Workspace) {
    ws.panes.forEach((p) => {
      const isActive = p.id === ws.activePaneId;
      p.element.style.borderColor = isActive ? theme.borderActive : theme.border;
    });
  }

  private removePaneByIndex(wsIdx: number, paneIdx: number) {
    const ws = this.workspaces[wsIdx];
    const pane = ws.panes[paneIdx];

    pane.terminal.dispose();
    pane.element.remove();
    if (pane.ptyId >= 0) {
      invoke("kill_pty", { ptyId: pane.ptyId }).catch(() => {});
    }

    ws.panes.splice(paneIdx, 1);

    if (ws.panes.length === 0) {
      // Last pane closed — remove workspace
      if (this.workspaces.length > 1) {
        ws.element.remove();
        this.workspaces.splice(wsIdx, 1);
        const newIdx = Math.min(wsIdx, this.workspaces.length - 1);
        this.switchWorkspace(newIdx);
      } else {
        // Last workspace — create a new pane
        this.addPane(ws);
      }
    } else {
      // Focus next pane
      const nextIdx = Math.min(paneIdx, ws.panes.length - 1);
      ws.activePaneId = ws.panes[nextIdx].id;
      ws.panes[nextIdx].fitAddon.fit();
      ws.panes[nextIdx].terminal.focus();
      this.updatePaneBorders(ws);
    }

    this.notify();
  }

  switchWorkspace(idx: number) {
    if (idx < 0 || idx >= this.workspaces.length) return;

    // Hide current
    if (this.activeWorkspaceIdx >= 0 && this.activeWorkspaceIdx < this.workspaces.length) {
      this.workspaces[this.activeWorkspaceIdx].element.remove();
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
        this.updatePaneBorders(ws);
      }, 10);
    }

    this.notify();
  }

  async splitPane(direction: "right" | "down") {
    const ws = this.activeWorkspace;
    if (!ws) return;

    ws.splitDirection = direction === "right" ? "row" : "column";
    ws.element.style.flexDirection = ws.splitDirection;

    await this.addPane(ws);

    // Re-fit all panes
    ws.panes.forEach((p) => p.fitAddon.fit());
    this.notify();
  }

  closeActivePane() {
    const ws = this.activeWorkspace;
    if (!ws) return;

    const idx = ws.panes.findIndex((p) => p.id === ws.activePaneId);
    if (idx < 0) return;

    this.removePaneByIndex(this.activeWorkspaceIdx, idx);
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

  // Navigate between panes with arrow keys
  focusDirection(direction: "left" | "right" | "up" | "down") {
    const ws = this.activeWorkspace;
    if (!ws || ws.panes.length <= 1) return;

    const currentIdx = ws.panes.findIndex((p) => p.id === ws.activePaneId);
    if (currentIdx < 0) return;

    let nextIdx: number;
    if (direction === "right" || direction === "down") {
      nextIdx = (currentIdx + 1) % ws.panes.length;
    } else {
      nextIdx = (currentIdx - 1 + ws.panes.length) % ws.panes.length;
    }

    this.setActivePane(ws, ws.panes[nextIdx]);
  }
}
