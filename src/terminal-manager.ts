/**
 * Terminal Manager — cmux-compatible workspace/pane/surface hierarchy
 *
 * Workspace (sidebar vertical tabs)
 *   └─ Pane(s) (split regions — horizontal/vertical tree)
 *       └─ Surface(s) (tabs within each pane — terminal, etc.)
 *
 * CRITICAL: xterm.js terminals can only be opened once. We create each terminal's
 * DOM container once and reuse it. Layout changes move/show/hide existing elements
 * rather than destroying and recreating them.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { theme, xtermTheme } from "./theme";
import "@xterm/xterm/css/xterm.css";

let _id = 0;
function uid(): string { return `id-${++_id}-${Date.now()}`; }

const FALLBACK_FONTS = 'Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace';
let resolvedFontFamily = FALLBACK_FONTS;

async function detectFont(): Promise<string> {
  try {
    const font = await invoke<string>("detect_font");
    if (font) {
      console.log(`[gnar-term] Detected terminal font: ${font}`);
      return `"${font}", ${FALLBACK_FONTS}`;
    }
  } catch {}
  return FALLBACK_FONTS;
}
export const fontReady = detectFont().then((f) => { resolvedFontFamily = f; });

// --- Data Types ---

export interface Surface {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  termElement: HTMLElement;  // persistent DOM element for this terminal
  ptyId: number;
  title: string;
  notification?: string;
  hasUnread: boolean;
  opened: boolean;  // whether terminal.open() has been called
}

export interface Pane {
  id: string;
  surfaces: Surface[];
  activeSurfaceId: string | null;
  element: HTMLElement;  // persistent pane container
}

export interface Workspace {
  id: string;
  name: string;
  panes: Pane[];
  splitDirections: Map<string, "horizontal" | "vertical">; // pane pair -> direction
  activePaneId: string | null;
  element: HTMLElement;  // persistent workspace container
}

// --- Manager ---

export class TerminalManager {
  workspaces: Workspace[] = [];
  activeWorkspaceIdx = -1;
  private container: HTMLElement;
  private onChangeCallbacks: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.setupListeners();
  }

  onChange(cb: () => void) { this.onChangeCallbacks.push(cb); }
  notify() { this.onChangeCallbacks.forEach((cb) => cb()); }

  get activeWorkspace(): Workspace | null {
    return this.workspaces[this.activeWorkspaceIdx] ?? null;
  }
  get activePane(): Pane | null {
    const ws = this.activeWorkspace;
    if (!ws) return null;
    return ws.panes.find((p) => p.id === ws.activePaneId) ?? null;
  }
  get activeSurface(): Surface | null {
    const pane = this.activePane;
    if (!pane) return null;
    return pane.surfaces.find((s) => s.id === pane.activeSurfaceId) ?? null;
  }

  getAllSurfaces(ws: Workspace): Surface[] {
    return ws.panes.flatMap((p) => p.surfaces);
  }

  // --- Event Listeners ---

  private async setupListeners() {
    await listen<{ pty_id: number; data: number[] }>("pty-output", (event) => {
      const { pty_id, data } = event.payload;
      const bytes = new Uint8Array(data);
      for (const ws of this.workspaces) {
        for (const s of this.getAllSurfaces(ws)) {
          if (s.ptyId === pty_id) { s.terminal.write(bytes); return; }
        }
      }
    });

    await listen<{ pty_id: number }>("pty-exit", (event) => {
      const { pty_id } = event.payload;
      for (const ws of this.workspaces) {
        for (const pane of ws.panes) {
          const idx = pane.surfaces.findIndex((s) => s.ptyId === pty_id);
          if (idx >= 0) { this.removeSurface(ws, pane, idx); return; }
        }
      }
    });

    await listen<{ pty_id: number; text: string }>("pty-notification", (event) => {
      const { pty_id, text } = event.payload;
      for (const ws of this.workspaces) {
        for (const s of this.getAllSurfaces(ws)) {
          if (s.ptyId === pty_id) {
            s.notification = text;
            s.hasUnread = true;
            this.notify();
            return;
          }
        }
      }
    });
  }

  // --- Create Surface (terminal.open called exactly once) ---

  private async createSurface(pane: Pane): Promise<Surface> {
    let ptyId: number;
    try {
      ptyId = await invoke<number>("spawn_pty", { cols: 80, rows: 24 });
    } catch (err) {
      console.error("Failed to spawn PTY:", err);
      ptyId = -1;
    }

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

    // Create persistent DOM element for this terminal
    const termElement = document.createElement("div");
    termElement.style.cssText = "flex: 1; min-height: 0; min-width: 0;";

    const surface: Surface = {
      id: uid(), terminal, fitAddon, termElement, ptyId,
      title: `Shell ${pane.surfaces.length + 1}`,
      hasUnread: false, opened: false,
    };

    terminal.onData((data) => {
      if (surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data });
    });
    terminal.onResize(({ cols, rows }) => {
      if (surface.ptyId >= 0) invoke("resize_pty", { ptyId: surface.ptyId, cols, rows });
    });
    terminal.onTitleChange((title) => { surface.title = title; this.notify(); });

    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;

    return surface;
  }

  // Open a terminal into its element (called once, idempotent)
  private openSurface(surface: Surface) {
    if (surface.opened) return;
    surface.terminal.open(surface.termElement);
    try { surface.terminal.loadAddon(new WebglAddon()); } catch {}
    surface.opened = true;
  }

  // --- Layout: build pane DOM without destroying terminals ---

  private buildPaneElement(pane: Pane, ws: Workspace) {
    const el = pane.element;
    el.innerHTML = ""; // clear only the pane's chrome (tab bar), not terminal elements

    el.style.cssText = `
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0;
      border: 1px solid ${pane.id === ws.activePaneId ? theme.borderActive : theme.border};
      border-radius: 4px; overflow: hidden;
    `;

    // Tab bar — only shown when multiple surfaces
    if (pane.surfaces.length > 1) {
      const tabBar = document.createElement("div");
      tabBar.style.cssText = `
        display: flex; align-items: center; gap: 1px;
        background: ${theme.tabBarBg}; border-bottom: 1px solid ${theme.tabBarBorder};
        height: 28px; padding: 0 4px; flex-shrink: 0;
      `;

      pane.surfaces.forEach((s, i) => {
        const isActive = s.id === pane.activeSurfaceId;
        const tab = document.createElement("div");
        tab.style.cssText = `
          padding: 2px 10px; font-size: 11px; cursor: pointer;
          color: ${isActive ? theme.fg : theme.fgMuted};
          background: ${isActive ? theme.bgActive : "transparent"};
          border-bottom: 2px solid ${isActive ? theme.accent : "transparent"};
          border-radius: 4px 4px 0 0; white-space: nowrap;
          display: flex; align-items: center; gap: 4px;
        `;

        if (s.hasUnread && !isActive) {
          const dot = document.createElement("span");
          dot.style.cssText = `width: 5px; height: 5px; border-radius: 50%; background: ${theme.notify}; flex-shrink: 0;`;
          tab.appendChild(dot);
        }

        const title = document.createElement("span");
        title.textContent = s.title || `Shell ${i + 1}`;
        title.style.cssText = "overflow: hidden; text-overflow: ellipsis;";
        tab.appendChild(title);

        // Close button
        const closeBtn = document.createElement("span");
        closeBtn.textContent = "×";
        closeBtn.style.cssText = `
          color: ${theme.fgDim}; font-size: 13px; cursor: pointer;
          margin-left: 4px; visibility: ${isActive ? "visible" : "hidden"};
        `;
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = pane.surfaces.indexOf(s);
          if (idx >= 0) this.removeSurface(ws, pane, idx);
        });
        closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = theme.danger; });
        closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = theme.fgDim; });
        tab.appendChild(closeBtn);

        tab.addEventListener("click", () => {
          pane.activeSurfaceId = s.id;
          s.hasUnread = false;
          this.showActiveSurface(pane);
          s.terminal.focus();
          this.notify();
        });

        tab.addEventListener("mouseenter", () => {
          if (!isActive) tab.style.background = theme.bgHighlight;
          closeBtn.style.visibility = "visible";
        });
        tab.addEventListener("mouseleave", () => {
          if (!isActive) tab.style.background = "transparent";
          if (!isActive) closeBtn.style.visibility = "hidden";
        });

        tabBar.appendChild(tab);
      });

      // + button
      const addBtn = document.createElement("span");
      addBtn.textContent = "+";
      addBtn.title = "New surface (⌘T)";
      addBtn.style.cssText = `color: ${theme.fgDim}; cursor: pointer; font-size: 14px; padding: 0 6px;`;
      addBtn.addEventListener("click", () => this.newSurface(ws, pane));
      addBtn.addEventListener("mouseenter", () => { addBtn.style.color = theme.fg; });
      addBtn.addEventListener("mouseleave", () => { addBtn.style.color = theme.fgDim; });
      tabBar.appendChild(addBtn);

      el.appendChild(tabBar);
    }

    // Attach all surface terminal elements (show active, hide others)
    for (const s of pane.surfaces) {
      this.openSurface(s);
      s.termElement.style.display = s.id === pane.activeSurfaceId ? "flex" : "none";
      el.appendChild(s.termElement);
    }

    // Click to focus pane
    el.addEventListener("mousedown", () => {
      if (ws.activePaneId !== pane.id) {
        ws.activePaneId = pane.id;
        this.updatePaneBorders(ws);
        this.notify();
      }
    });

    // Fit active terminal
    const activeSurface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (activeSurface) {
      const observer = new ResizeObserver(() => activeSurface.fitAddon.fit());
      observer.observe(el);
      setTimeout(() => activeSurface.fitAddon.fit(), 20);
    }
  }

  // Show/hide surfaces in a pane without rebuilding
  private showActiveSurface(pane: Pane) {
    for (const s of pane.surfaces) {
      s.termElement.style.display = s.id === pane.activeSurfaceId ? "flex" : "none";
      if (s.id === pane.activeSurfaceId) {
        setTimeout(() => s.fitAddon.fit(), 10);
      }
    }
  }

  // --- Layout workspace (builds split structure, reuses pane elements) ---

  private layoutWorkspace(ws: Workspace) {
    ws.element.innerHTML = "";

    if (ws.panes.length === 0) return;

    if (ws.panes.length === 1) {
      this.buildPaneElement(ws.panes[0], ws);
      ws.element.appendChild(ws.panes[0].element);
      return;
    }

    // Multiple panes — create flex containers for splits
    // Simple approach: chain splits in the last-used direction
    const container = document.createElement("div");
    const lastDirection = ws.splitDirections.get("last") || "horizontal";
    container.style.cssText = `
      display: flex; flex: 1; min-width: 0; min-height: 0; gap: 2px;
      flex-direction: ${lastDirection === "vertical" ? "column" : "row"};
    `;

    for (const pane of ws.panes) {
      this.buildPaneElement(pane, ws);
      pane.element.style.flex = "1";
      container.appendChild(pane.element);
    }

    ws.element.appendChild(container);
  }

  private updatePaneBorders(ws: Workspace) {
    for (const pane of ws.panes) {
      pane.element.style.borderColor = pane.id === ws.activePaneId ? theme.borderActive : theme.border;
    }
  }

  // --- Workspace Lifecycle ---

  async createWorkspace(name: string): Promise<Workspace> {
    const wsElement = document.createElement("div");
    wsElement.style.cssText = "flex: 1; display: flex; min-height: 0; min-width: 0;";

    const paneEl = document.createElement("div");
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };

    const ws: Workspace = {
      id: uid(), name, panes: [pane],
      splitDirections: new Map(), activePaneId: pane.id, element: wsElement,
    };

    this.workspaces.push(ws);
    this.switchWorkspace(this.workspaces.length - 1);

    await this.createSurface(pane);
    this.layoutWorkspace(ws);

    const surface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
    return ws;
  }

  switchWorkspace(idx: number) {
    if (idx < 0 || idx >= this.workspaces.length) return;

    // Detach current workspace
    if (this.activeWorkspaceIdx >= 0 && this.activeWorkspaceIdx < this.workspaces.length) {
      this.workspaces[this.activeWorkspaceIdx].element.remove();
    }

    this.activeWorkspaceIdx = idx;
    const ws = this.workspaces[idx];
    this.container.appendChild(ws.element);

    // Re-layout (moves existing elements, doesn't recreate terminals)
    this.layoutWorkspace(ws);

    // Focus active surface
    const surface = this.activeSurface;
    setTimeout(() => {
      surface?.fitAddon.fit();
      surface?.terminal.focus();
    }, 20);
    this.notify();
  }

  closeActiveWorkspace() {
    if (this.workspaces.length <= 1) return;
    const ws = this.workspaces[this.activeWorkspaceIdx];
    for (const s of this.getAllSurfaces(ws)) {
      s.terminal.dispose();
      if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
    }
    ws.element.remove();
    this.workspaces.splice(this.activeWorkspaceIdx, 1);
    this.switchWorkspace(Math.min(this.activeWorkspaceIdx, this.workspaces.length - 1));
  }

  // --- Surface (Tab) Management ---

  async newSurface(ws?: Workspace, pane?: Pane) {
    ws = ws ?? this.activeWorkspace ?? undefined;
    pane = pane ?? this.activePane ?? undefined;
    if (!ws || !pane) return;

    await this.createSurface(pane);
    this.buildPaneElement(pane, ws);  // rebuild just this pane's chrome
    const surface = pane.surfaces.find((s) => s.id === pane!.activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  nextSurface() {
    const pane = this.activePane;
    const ws = this.activeWorkspace;
    if (!pane || !ws || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
    this.buildPaneElement(pane, ws);
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  prevSurface() {
    const pane = this.activePane;
    const ws = this.activeWorkspace;
    if (!pane || !ws || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
    this.buildPaneElement(pane, ws);
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  selectSurface(num: number) {
    const pane = this.activePane;
    const ws = this.activeWorkspace;
    if (!pane || !ws) return;
    const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
    if (idx >= 0 && idx < pane.surfaces.length) {
      pane.activeSurfaceId = pane.surfaces[idx].id;
      this.buildPaneElement(pane, ws);
      this.activeSurface?.terminal.focus();
      this.notify();
    }
  }

  closeSurface() {
    const ws = this.activeWorkspace;
    const pane = this.activePane;
    if (!ws || !pane) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    if (idx < 0) return;
    this.removeSurface(ws, pane, idx);
  }

  private removeSurface(ws: Workspace, pane: Pane, surfaceIdx: number) {
    const surface = pane.surfaces[surfaceIdx];
    surface.terminal.dispose();
    surface.termElement.remove();
    if (surface.ptyId >= 0) invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    pane.surfaces.splice(surfaceIdx, 1);

    if (pane.surfaces.length === 0) {
      // Remove pane
      this.removePane(ws, pane);
    } else {
      pane.activeSurfaceId = pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)].id;
      this.buildPaneElement(pane, ws);
      const s = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
      s?.terminal.focus();
    }
    this.notify();
  }

  // --- Pane Split / Remove ---

  async splitPane(direction: "right" | "down") {
    const ws = this.activeWorkspace;
    if (!ws) return;

    const paneEl = document.createElement("div");
    const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };
    await this.createSurface(newPane);

    ws.panes.push(newPane);
    ws.activePaneId = newPane.id;
    ws.splitDirections.set("last", direction === "right" ? "horizontal" : "vertical");

    this.layoutWorkspace(ws);
    const surface = newPane.surfaces.find((s) => s.id === newPane.activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  private removePane(ws: Workspace, pane: Pane) {
    pane.element.remove();
    const idx = ws.panes.indexOf(pane);
    if (idx >= 0) ws.panes.splice(idx, 1);

    if (ws.panes.length === 0) {
      // Last pane gone — create a fresh one
      const paneEl = document.createElement("div");
      const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };
      ws.panes.push(newPane);
      ws.activePaneId = newPane.id;
      this.createSurface(newPane).then(() => {
        this.layoutWorkspace(ws);
        this.activeSurface?.terminal.focus();
        this.notify();
      });
    } else {
      ws.activePaneId = ws.panes[Math.min(idx, ws.panes.length - 1)].id;
      this.layoutWorkspace(ws);
      this.activeSurface?.terminal.focus();
    }
  }

  closeActivePane() {
    const ws = this.activeWorkspace;
    const pane = this.activePane;
    if (!ws || !pane) return;
    // Kill all surfaces in the pane
    for (const s of [...pane.surfaces]) {
      s.terminal.dispose();
      s.termElement.remove();
      if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
    }
    pane.surfaces = [];
    this.removePane(ws, pane);
    this.notify();
  }

  // --- Pane Navigation ---

  focusDirection(direction: "left" | "right" | "up" | "down") {
    const ws = this.activeWorkspace;
    if (!ws || ws.panes.length <= 1) return;
    const currentIdx = ws.panes.findIndex((p) => p.id === ws.activePaneId);
    let nextIdx: number;
    if (direction === "right" || direction === "down") {
      nextIdx = (currentIdx + 1) % ws.panes.length;
    } else {
      nextIdx = (currentIdx - 1 + ws.panes.length) % ws.panes.length;
    }
    ws.activePaneId = ws.panes[nextIdx].id;
    this.updatePaneBorders(ws);
    const surface = ws.panes[nextIdx].surfaces.find((s) => s.id === ws.panes[nextIdx].activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  // --- Pane Zoom ---

  private zoomedPaneId: string | null = null;

  togglePaneZoom() {
    const ws = this.activeWorkspace;
    if (!ws) return;
    this.zoomedPaneId = this.zoomedPaneId ? null : ws.activePaneId;

    if (this.zoomedPaneId) {
      // Hide all panes except zoomed
      for (const pane of ws.panes) {
        pane.element.style.display = pane.id === this.zoomedPaneId ? "flex" : "none";
      }
    } else {
      // Show all panes
      for (const pane of ws.panes) {
        pane.element.style.display = "flex";
      }
    }
    this.activeSurface?.fitAddon.fit();
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  // --- Flash ---

  flashFocusedPane() {
    const pane = this.activePane;
    if (!pane?.element) return;
    const el = pane.element;
    el.style.boxShadow = `inset 0 0 0 2px ${theme.accent}, 0 0 12px ${theme.notifyGlow}`;
    setTimeout(() => { el.style.boxShadow = "none"; }, 400);
  }
}
