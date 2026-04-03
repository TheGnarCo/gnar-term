/**
 * Terminal Manager — cmux-compatible workspace/pane/surface hierarchy
 *
 * Workspace (sidebar vertical tabs)
 *   └─ Pane(s) (split regions — horizontal/vertical tree)
 *       └─ Surface(s) (tabs within each pane — terminal, etc.)
 *
 * Key distinction from v1: surfaces (tabs) live INSIDE panes, not at workspace level.
 * Each pane has its own tab bar. Splits divide the workspace into pane regions.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { theme, xtermTheme } from "./theme";
import "@xterm/xterm/css/xterm.css";

// --- Types ---

let _id = 0;
function uid(): string {
  return `id-${++_id}-${Date.now()}`;
}

// Sensible fallback font stack
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
  console.log("[gnar-term] No terminal font config found, using system defaults");
  return FALLBACK_FONTS;
}

// Exported so main.ts can await before creating first workspace
export const fontReady = detectFont().then((f) => { resolvedFontFamily = f; });

export interface Surface {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  ptyId: number;
  title: string;
  notification?: string;
  hasUnread: boolean;
}

export interface Pane {
  id: string;
  surfaces: Surface[];
  activeSurfaceId: string | null;
  element: HTMLElement;
}

export interface SplitNode {
  type: "pane" | "split";
  pane?: Pane;               // if type === "pane"
  direction?: "horizontal" | "vertical"; // if type === "split"
  ratio?: number;            // 0-1, default 0.5
  children?: [SplitNode, SplitNode]; // if type === "split"
  element: HTMLElement;
}

export interface Workspace {
  id: string;
  name: string;
  rootNode: SplitNode;
  activePaneId: string | null;
  element: HTMLElement;
}

// --- Terminal Manager ---

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

  // --- Getters ---

  get activeWorkspace(): Workspace | null {
    return this.workspaces[this.activeWorkspaceIdx] ?? null;
  }

  get activePane(): Pane | null {
    const ws = this.activeWorkspace;
    if (!ws) return null;
    return this.findPane(ws.rootNode, ws.activePaneId);
  }

  get activeSurface(): Surface | null {
    const pane = this.activePane;
    if (!pane) return null;
    return pane.surfaces.find((s) => s.id === pane.activeSurfaceId) ?? null;
  }

  // --- All panes in a workspace ---

  getAllPanes(node: SplitNode): Pane[] {
    if (node.type === "pane" && node.pane) return [node.pane];
    if (node.children) return [...this.getAllPanes(node.children[0]), ...this.getAllPanes(node.children[1])];
    return [];
  }

  getAllSurfaces(ws: Workspace): Surface[] {
    return this.getAllPanes(ws.rootNode).flatMap((p) => p.surfaces);
  }

  private findPane(node: SplitNode, paneId: string | null): Pane | null {
    if (!paneId) return null;
    if (node.type === "pane" && node.pane?.id === paneId) return node.pane;
    if (node.children) {
      return this.findPane(node.children[0], paneId) || this.findPane(node.children[1], paneId);
    }
    return null;
  }

  // --- Event Listeners ---

  private async setupListeners() {
    await listen<{ pty_id: number; data: number[] }>("pty-output", (event) => {
      const { pty_id, data } = event.payload;
      const bytes = new Uint8Array(data);
      for (const ws of this.workspaces) {
        for (const surface of this.getAllSurfaces(ws)) {
          if (surface.ptyId === pty_id) {
            surface.terminal.write(bytes);
            return;
          }
        }
      }
    });

    await listen<{ pty_id: number }>("pty-exit", (event) => {
      const { pty_id } = event.payload;
      for (const ws of this.workspaces) {
        for (const pane of this.getAllPanes(ws.rootNode)) {
          const idx = pane.surfaces.findIndex((s) => s.ptyId === pty_id);
          if (idx >= 0) {
            this.removeSurface(ws, pane, idx);
            return;
          }
        }
      }
    });

    await listen<{ pty_id: number; text: string }>("pty-notification", (event) => {
      const { pty_id, text } = event.payload;
      for (const ws of this.workspaces) {
        for (const surface of this.getAllSurfaces(ws)) {
          if (surface.ptyId === pty_id) {
            surface.notification = text;
            surface.hasUnread = true;
            this.notify();
            return;
          }
        }
      }
    });
  }

  // --- Create Surface ---

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

    const surface: Surface = {
      id: uid(),
      terminal,
      fitAddon,
      ptyId,
      title: `Shell ${pane.surfaces.length + 1}`,
      hasUnread: false,
    };

    // Forward input
    terminal.onData((data) => {
      if (surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data });
    });
    terminal.onResize(({ cols, rows }) => {
      if (surface.ptyId >= 0) invoke("resize_pty", { ptyId: surface.ptyId, cols, rows });
    });
    terminal.onTitleChange((title) => {
      surface.title = title;
      this.notify();
    });

    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;

    return surface;
  }

  // --- Render Pane ---

  private renderPane(pane: Pane, ws: Workspace): HTMLElement {
    const el = document.createElement("div");
    el.className = "gnar-pane";
    el.style.cssText = `
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0;
      border: 1px solid ${pane.id === ws.activePaneId ? theme.borderActive : theme.border};
      border-radius: 4px; overflow: hidden;
    `;

    // Per-pane tab bar (surfaces)
    if (pane.surfaces.length > 1) {
      const tabBar = document.createElement("div");
      tabBar.style.cssText = `
        display: flex; align-items: center; gap: 1px;
        background: ${theme.tabBarBg}; border-bottom: 1px solid ${theme.tabBarBorder};
        height: 28px; padding: 0 4px; flex-shrink: 0; overflow-x: auto;
      `;
      tabBar.style.scrollbarWidth = "none";

      pane.surfaces.forEach((s, i) => {
        const tab = document.createElement("div");
        const isActive = s.id === pane.activeSurfaceId;
        tab.style.cssText = `
          padding: 2px 10px; font-size: 11px; cursor: pointer;
          color: ${isActive ? theme.fg : theme.fgMuted};
          background: ${isActive ? theme.bgActive : "transparent"};
          border-bottom: 2px solid ${isActive ? theme.accent : "transparent"};
          border-radius: 4px 4px 0 0; white-space: nowrap;
          display: flex; align-items: center; gap: 4px;
        `;

        if (s.hasUnread) {
          const dot = document.createElement("span");
          dot.style.cssText = `width: 5px; height: 5px; border-radius: 50%; background: ${theme.notify};`;
          tab.appendChild(dot);
        }

        const title = document.createElement("span");
        title.textContent = s.title || `Shell ${i + 1}`;
        tab.appendChild(title);

        tab.addEventListener("click", () => {
          pane.activeSurfaceId = s.id;
          s.hasUnread = false;
          this.renderWorkspaceContent(ws);
          s.terminal.focus();
          this.notify();
        });

        tab.addEventListener("mouseenter", () => { if (!isActive) tab.style.background = theme.bgHighlight; });
        tab.addEventListener("mouseleave", () => { if (!isActive) tab.style.background = "transparent"; });

        tabBar.appendChild(tab);
      });

      // + button for new surface in this pane
      const addBtn = document.createElement("span");
      addBtn.textContent = "+";
      addBtn.style.cssText = `
        color: ${theme.fgDim}; cursor: pointer; font-size: 14px;
        padding: 0 6px; margin-left: 2px;
      `;
      addBtn.addEventListener("click", () => this.newSurface(ws, pane));
      addBtn.addEventListener("mouseenter", () => { addBtn.style.color = theme.fg; });
      addBtn.addEventListener("mouseleave", () => { addBtn.style.color = theme.fgDim; });
      tabBar.appendChild(addBtn);

      el.appendChild(tabBar);
    }

    // Terminal container for the active surface
    const termContainer = document.createElement("div");
    termContainer.style.cssText = "flex: 1; min-height: 0;";

    const activeSurface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (activeSurface) {
      activeSurface.terminal.open(termContainer);
      try { activeSurface.terminal.loadAddon(new WebglAddon()); } catch {}
      setTimeout(() => activeSurface.fitAddon.fit(), 10);

      const resizeObserver = new ResizeObserver(() => activeSurface.fitAddon.fit());
      resizeObserver.observe(termContainer);
    }

    // Click to focus this pane
    el.addEventListener("mousedown", () => {
      ws.activePaneId = pane.id;
      this.updatePaneBorders(ws);
      activeSurface?.terminal.focus();
      this.notify();
    });

    pane.element = el;
    return el;
  }

  // --- Render Split Tree ---

  private renderSplitNode(node: SplitNode, ws: Workspace): HTMLElement {
    if (node.type === "pane" && node.pane) {
      const el = this.renderPane(node.pane, ws);
      node.element = el;
      return el;
    }

    const container = document.createElement("div");
    container.style.cssText = `
      display: flex; flex: 1; min-width: 0; min-height: 0; gap: 2px;
      flex-direction: ${node.direction === "vertical" ? "column" : "row"};
    `;

    if (node.children) {
      const child0 = this.renderSplitNode(node.children[0], ws);
      const child1 = this.renderSplitNode(node.children[1], ws);
      const ratio = node.ratio ?? 0.5;
      child0.style.flex = `${ratio}`;
      child1.style.flex = `${1 - ratio}`;
      container.appendChild(child0);
      container.appendChild(child1);
    }

    node.element = container;
    return container;
  }

  // --- Render Workspace Content ---

  renderWorkspaceContent(ws: Workspace) {
    ws.element.innerHTML = "";
    const content = this.renderSplitNode(ws.rootNode, ws);
    ws.element.appendChild(content);
  }

  private updatePaneBorders(ws: Workspace) {
    for (const pane of this.getAllPanes(ws.rootNode)) {
      if (pane.element) {
        pane.element.style.borderColor = pane.id === ws.activePaneId ? theme.borderActive : theme.border;
      }
    }
  }

  // --- Workspace Lifecycle ---

  async createWorkspace(name: string): Promise<Workspace> {
    const wsElement = document.createElement("div");
    wsElement.style.cssText = "flex: 1; display: flex; min-height: 0; min-width: 0;";

    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: wsElement };
    const rootNode: SplitNode = { type: "pane", pane, element: wsElement };

    const ws: Workspace = { id: uid(), name, rootNode, activePaneId: pane.id, element: wsElement };
    this.workspaces.push(ws);
    this.switchWorkspace(this.workspaces.length - 1);

    await this.createSurface(pane);
    this.renderWorkspaceContent(ws);
    const activeSurface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    activeSurface?.terminal.focus();

    this.notify();
    return ws;
  }

  switchWorkspace(idx: number) {
    if (idx < 0 || idx >= this.workspaces.length) return;
    if (this.activeWorkspaceIdx >= 0 && this.activeWorkspaceIdx < this.workspaces.length) {
      this.workspaces[this.activeWorkspaceIdx].element.remove();
    }
    this.activeWorkspaceIdx = idx;
    const ws = this.workspaces[idx];
    this.container.appendChild(ws.element);

    // Re-render and focus
    this.renderWorkspaceContent(ws);
    const pane = this.findPane(ws.rootNode, ws.activePaneId);
    const surface = pane?.surfaces.find((s) => s.id === pane.activeSurfaceId);
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
    this.renderWorkspaceContent(ws);
    const surface = pane.surfaces.find((s) => s.id === pane!.activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  nextSurface() {
    const pane = this.activePane;
    if (!pane || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
    this.renderWorkspaceContent(this.activeWorkspace!);
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  prevSurface() {
    const pane = this.activePane;
    if (!pane || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
    this.renderWorkspaceContent(this.activeWorkspace!);
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  selectSurface(num: number) {
    const pane = this.activePane;
    if (!pane) return;
    const idx = num === 9 ? pane.surfaces.length - 1 : num - 1;
    if (idx >= 0 && idx < pane.surfaces.length) {
      pane.activeSurfaceId = pane.surfaces[idx].id;
      this.renderWorkspaceContent(this.activeWorkspace!);
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
    if (surface.ptyId >= 0) invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    pane.surfaces.splice(surfaceIdx, 1);

    if (pane.surfaces.length === 0) {
      // Pane has no surfaces — remove the pane from the split tree
      this.removePaneFromTree(ws, pane.id);
    } else {
      pane.activeSurfaceId = pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)].id;
      this.renderWorkspaceContent(ws);
      const s = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
      s?.terminal.focus();
    }
    this.notify();
  }

  // --- Split Pane ---

  async splitPane(direction: "right" | "down") {
    const ws = this.activeWorkspace;
    if (!ws) return;
    const currentPane = this.activePane;
    if (!currentPane) return;

    // Create new pane with a surface
    const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: document.createElement("div") };
    await this.createSurface(newPane);

    // Find the current pane's node in the tree and replace it with a split
    this.replacePaneWithSplit(ws.rootNode, currentPane.id, newPane, direction === "right" ? "horizontal" : "vertical");

    ws.activePaneId = newPane.id;
    this.renderWorkspaceContent(ws);
    const surface = newPane.surfaces.find((s) => s.id === newPane.activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  private replacePaneWithSplit(node: SplitNode, targetPaneId: string, newPane: Pane, direction: "horizontal" | "vertical"): boolean {
    if (node.type === "pane" && node.pane?.id === targetPaneId) {
      // Replace this leaf with a split containing [oldPane, newPane]
      const oldPane = node.pane;
      node.type = "split";
      node.direction = direction;
      node.ratio = 0.5;
      node.pane = undefined;
      node.children = [
        { type: "pane", pane: oldPane, element: document.createElement("div") },
        { type: "pane", pane: newPane, element: document.createElement("div") },
      ];
      return true;
    }

    if (node.children) {
      return this.replacePaneWithSplit(node.children[0], targetPaneId, newPane, direction) ||
             this.replacePaneWithSplit(node.children[1], targetPaneId, newPane, direction);
    }
    return false;
  }

  private removePaneFromTree(ws: Workspace, paneId: string) {
    const allPanes = this.getAllPanes(ws.rootNode);
    if (allPanes.length <= 1) {
      // Last pane — create a new one instead of removing
      const pane = allPanes[0];
      if (pane) {
        this.createSurface(pane).then(() => {
          this.renderWorkspaceContent(ws);
          const s = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
          s?.terminal.focus();
          this.notify();
        });
      }
      return;
    }

    // Find the parent split and replace it with the sibling
    this.collapsePane(ws.rootNode, paneId, null, ws);
    ws.activePaneId = this.getAllPanes(ws.rootNode)[0]?.id ?? null;
    this.renderWorkspaceContent(ws);
    const activeSurface = this.activeSurface;
    activeSurface?.terminal.focus();
    this.notify();
  }

  private collapsePane(node: SplitNode, targetPaneId: string, parent: SplitNode | null, ws: Workspace): boolean {
    if (node.type !== "split" || !node.children) return false;

    for (let i = 0; i < 2; i++) {
      const child = node.children[i];
      if (child.type === "pane" && child.pane?.id === targetPaneId) {
        // Replace this split node with the sibling
        const sibling = node.children[1 - i];
        node.type = sibling.type;
        node.pane = sibling.pane;
        node.direction = sibling.direction;
        node.ratio = sibling.ratio;
        node.children = sibling.children;
        return true;
      }
      if (this.collapsePane(child, targetPaneId, node, ws)) return true;
    }
    return false;
  }

  // --- Pane Focus Navigation ---

  focusDirection(direction: "left" | "right" | "up" | "down") {
    const ws = this.activeWorkspace;
    if (!ws) return;
    const panes = this.getAllPanes(ws.rootNode);
    if (panes.length <= 1) return;

    const currentIdx = panes.findIndex((p) => p.id === ws.activePaneId);
    let nextIdx: number;
    if (direction === "right" || direction === "down") {
      nextIdx = (currentIdx + 1) % panes.length;
    } else {
      nextIdx = (currentIdx - 1 + panes.length) % panes.length;
    }

    ws.activePaneId = panes[nextIdx].id;
    this.updatePaneBorders(ws);
    const surface = panes[nextIdx].surfaces.find((s) => s.id === panes[nextIdx].activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  // --- Pane Zoom ---

  private zoomedPaneId: string | null = null;

  togglePaneZoom() {
    const ws = this.activeWorkspace;
    if (!ws) return;
    // Toggle: if zoomed, un-zoom by re-rendering. If not, render only the active pane.
    this.zoomedPaneId = this.zoomedPaneId ? null : ws.activePaneId;
    if (this.zoomedPaneId) {
      const pane = this.activePane;
      if (pane) {
        ws.element.innerHTML = "";
        const el = this.renderPane(pane, ws);
        ws.element.appendChild(el);
      }
    } else {
      this.renderWorkspaceContent(ws);
    }
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  // --- Flash focused pane ---

  flashFocusedPane() {
    const pane = this.activePane;
    if (!pane?.element) return;
    const el = pane.element;
    el.style.borderColor = theme.accent;
    el.style.boxShadow = `0 0 12px ${theme.notifyGlow}`;
    setTimeout(() => {
      el.style.borderColor = pane.id === this.activeWorkspace?.activePaneId ? theme.borderActive : theme.border;
      el.style.boxShadow = "none";
    }, 400);
  }
}
