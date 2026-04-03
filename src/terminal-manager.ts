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

// Bundled Nerd Font guarantees powerline glyphs always render.
// User's system font tried first via detect_font, bundled font is the safety net.
const BUNDLED_FONT = '"JetBrainsMono Nerd Font Mono"';
const SYSTEM_FALLBACK = 'Menlo, "DejaVu Sans Mono", monospace';
let resolvedFontFamily = `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;

async function detectFont(): Promise<string> {
  try {
    const font = await invoke<string>("detect_font");
    if (font) {
      console.log(`[gnar-term] Detected user font: ${font}`);
      return `"${font}", ${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
    }
  } catch (e) {
    console.log(`[gnar-term] Font detection error:`, e);
  }
  console.log(`[gnar-term] Using bundled JetBrainsMono Nerd Font Mono`);
  return `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
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

export type SplitNode = 
  | { type: "pane"; pane: Pane }
  | { type: "split"; direction: "horizontal" | "vertical"; children: [SplitNode, SplitNode]; ratio: number };

export interface Workspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
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
  
  getAllPanes(node: SplitNode): Pane[] {
    if (node.type === "pane") return [node.pane];
    return [...this.getAllPanes(node.children[0]), ...this.getAllPanes(node.children[1])];
  }

  get activePane(): Pane | null {
    const ws = this.activeWorkspace;
    if (!ws) return null;
    const panes = this.getAllPanes(ws.splitRoot);
    return panes.find((p) => p.id === ws.activePaneId) ?? null;
  }
  
  get activeSurface(): Surface | null {
    const pane = this.activePane;
    if (!pane) return null;
    return pane.surfaces.find((s) => s.id === pane.activeSurfaceId) ?? null;
  }

  getAllSurfaces(ws: Workspace): Surface[] {
    return this.getAllPanes(ws.splitRoot).flatMap((p) => p.surfaces);
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
        for (const pane of this.getAllPanes(ws.splitRoot)) {
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

  private openSurface(surface: Surface) {
    if (surface.opened) return;
    surface.terminal.open(surface.termElement);
    try { surface.terminal.loadAddon(new WebglAddon()); } catch {}
    surface.opened = true;
  }

  // --- Layout: build pane DOM without destroying terminals ---

  private buildPaneElement(pane: Pane, ws: Workspace) {
    const el = pane.element;
    el.innerHTML = "";

    el.style.cssText = `
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0;
      border: 1px solid ${pane.id === ws.activePaneId ? theme.borderActive : theme.border};
      border-radius: 4px; overflow: hidden;
    `;

    const tabBar = document.createElement("div");
    tabBar.style.cssText = `
      display: flex; align-items: center; gap: 1px;
      background: ${theme.tabBarBg}; border-bottom: 1px solid ${theme.tabBarBorder};
      height: 28px; padding: 0 4px; flex-shrink: 0; overflow-x: auto;
    `;
    tabBar.style.scrollbarWidth = "none";

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

      const addBtn = document.createElement("span");
      addBtn.textContent = "+";
      addBtn.title = "New surface (⌘T)";
      addBtn.style.cssText = `color: ${theme.fgDim}; cursor: pointer; font-size: 14px; padding: 0 6px;`;
      addBtn.addEventListener("click", () => this.newSurface(ws, pane));
      addBtn.addEventListener("mouseenter", () => { addBtn.style.color = theme.fg; });
      addBtn.addEventListener("mouseleave", () => { addBtn.style.color = theme.fgDim; });
      tabBar.appendChild(addBtn);

      const spacer = document.createElement("div");
      spacer.style.cssText = "flex: 1;";
      tabBar.appendChild(spacer);

      const controls = document.createElement("div");
      controls.style.cssText = "display: flex; align-items: center; gap: 2px; padding-right: 2px;";

      const createPaneBtn = (icon: string, title: string, onClick: () => void) => {
        const btn = document.createElement("span");
        btn.textContent = icon;
        btn.title = title;
        btn.style.cssText = `
          color: ${theme.fgDim}; cursor: pointer; font-size: 14px;
          padding: 2px 6px; border-radius: 3px; display: flex; align-items: center; justify-content: center;
        `;
        btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
        btn.addEventListener("mouseenter", () => {
          btn.style.background = title.includes("Close") ? theme.danger : theme.bgHighlight;
          btn.style.color = title.includes("Close") ? "#fff" : theme.fg;
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "transparent";
          btn.style.color = theme.fgDim;
        });
        return btn;
      };

      controls.appendChild(createPaneBtn("◫", "Split Right (⌘D)", () => {
        ws.activePaneId = pane.id;
        this.splitPane("horizontal");
      }));
      controls.appendChild(createPaneBtn("⊟", "Split Down (⇧⌘D)", () => {
        ws.activePaneId = pane.id;
        this.splitPane("vertical");
      }));
      controls.appendChild(createPaneBtn("✕", "Close Pane", () => {
        ws.activePaneId = pane.id;
        this.closeActivePane();
      }));

      tabBar.appendChild(controls);
      el.appendChild(tabBar);

    for (const s of pane.surfaces) {
      this.openSurface(s);
      s.termElement.style.display = s.id === pane.activeSurfaceId ? "flex" : "none";
      el.appendChild(s.termElement);
    }

    el.addEventListener("mousedown", () => {
      if (ws.activePaneId !== pane.id) {
        ws.activePaneId = pane.id;
        this.updatePaneBorders(ws);
        this.notify();
      }
    });

    const activeSurface = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (activeSurface) {
      const observer = new ResizeObserver(() => activeSurface.fitAddon.fit());
      observer.observe(el);
      setTimeout(() => activeSurface.fitAddon.fit(), 20);
    }
  }

  private showActiveSurface(pane: Pane) {
    for (const s of pane.surfaces) {
      s.termElement.style.display = s.id === pane.activeSurfaceId ? "flex" : "none";
      if (s.id === pane.activeSurfaceId) {
        setTimeout(() => s.fitAddon.fit(), 10);
      }
    }
  }

  // --- Layout workspace ---

  private renderSplitNode(node: SplitNode, ws: Workspace): HTMLElement {
    if (node.type === "pane") {
      this.buildPaneElement(node.pane, ws);
      node.pane.element.style.flex = "1";
      return node.pane.element;
    } else {
      const container = document.createElement("div");
      container.style.cssText = `
        display: flex; flex: 1; min-width: 0; min-height: 0; gap: 2px;
        flex-direction: ${node.direction === "vertical" ? "column" : "row"};
      `;
      const child1 = this.renderSplitNode(node.children[0], ws);
      const child2 = this.renderSplitNode(node.children[1], ws);
      
      // Use ratio if needed, but for now flex:1 is fine
      child1.style.flex = "1";
      child2.style.flex = "1";
      
      container.appendChild(child1);
      container.appendChild(child2);
      return container;
    }
  }

  private layoutWorkspace(ws: Workspace) {
    ws.element.innerHTML = "";
    if (ws.splitRoot) {
      const rootEl = this.renderSplitNode(ws.splitRoot, ws);
      ws.element.appendChild(rootEl);
    }
  }

  private updatePaneBorders(ws: Workspace) {
    const panes = this.getAllPanes(ws.splitRoot);
    for (const pane of panes) {
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
      id: uid(), name, splitRoot: { type: "pane", pane },
      activePaneId: pane.id, element: wsElement,
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

    if (this.activeWorkspaceIdx >= 0 && this.activeWorkspaceIdx < this.workspaces.length) {
      this.workspaces[this.activeWorkspaceIdx].element.remove();
    }

    this.activeWorkspaceIdx = idx;
    const ws = this.workspaces[idx];
    this.container.appendChild(ws.element);

    this.layoutWorkspace(ws);

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

  // --- Surface Management ---

  async newSurface(ws?: Workspace, pane?: Pane) {
    ws = ws ?? this.activeWorkspace ?? undefined;
    pane = pane ?? this.activePane ?? undefined;
    if (!ws || !pane) return;

    await this.createSurface(pane);
    this.buildPaneElement(pane, ws);
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

  private findParentSplit(node: SplitNode, paneId: string): { parent: SplitNode, index: number } | null {
    if (node.type === "pane") return null;
    
    if (node.children[0].type === "pane" && node.children[0].pane.id === paneId) {
      return { parent: node, index: 0 };
    }
    if (node.children[1].type === "pane" && node.children[1].pane.id === paneId) {
      return { parent: node, index: 1 };
    }
    
    const left = this.findParentSplit(node.children[0], paneId);
    if (left) return left;
    return this.findParentSplit(node.children[1], paneId);
  }

  private replacePaneWithSplit(node: SplitNode, targetPaneId: string, newSplit: SplitNode): boolean {
    if (node.type === "pane") return false;
    
    if (node.children[0].type === "pane" && node.children[0].pane.id === targetPaneId) {
      node.children[0] = newSplit;
      return true;
    }
    if (node.children[1].type === "pane" && node.children[1].pane.id === targetPaneId) {
      node.children[1] = newSplit;
      return true;
    }
    
    return this.replacePaneWithSplit(node.children[0], targetPaneId, newSplit) || 
           this.replacePaneWithSplit(node.children[1], targetPaneId, newSplit);
  }

  async splitPane(direction: "horizontal" | "vertical") {
    const ws = this.activeWorkspace;
    const activePane = this.activePane;
    if (!ws || !activePane) return;

    const paneEl = document.createElement("div");
    const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };
    await this.createSurface(newPane);

    const newSplit: SplitNode = {
      type: "split",
      direction,
      children: [{ type: "pane", pane: activePane }, { type: "pane", pane: newPane }],
      ratio: 0.5
    };

    if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === activePane.id) {
      ws.splitRoot = newSplit;
    } else {
      this.replacePaneWithSplit(ws.splitRoot, activePane.id, newSplit);
    }

    ws.activePaneId = newPane.id;

    this.layoutWorkspace(ws);
    const surface = newPane.surfaces.find((s) => s.id === newPane.activeSurfaceId);
    surface?.terminal.focus();
    this.notify();
  }

  private removePane(ws: Workspace, pane: Pane) {
    pane.element.remove();
    
    if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
      // Last pane gone
      const paneEl = document.createElement("div");
      const newPane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };
      ws.splitRoot = { type: "pane", pane: newPane };
      ws.activePaneId = newPane.id;
      this.createSurface(newPane).then(() => {
        this.layoutWorkspace(ws);
        this.activeSurface?.terminal.focus();
        this.notify();
      });
      return;
    }
    
    const parentInfo = this.findParentSplit(ws.splitRoot, pane.id);
    if (parentInfo) {
      const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
      
      // Find parent of parentInfo.parent
      const grandParentInfo = this.findParentSplit(ws.splitRoot, parentInfo.parent.type === "pane" ? "" : parentInfo.parent.children[0].type === "pane" ? parentInfo.parent.children[0].pane.id : ""); // Not trivial, so we do a general replace:
      
      // Helper to replace node with sibling
      const replaceNode = (root: SplitNode, target: SplitNode, replacement: SplitNode): boolean => {
        if (root.type === "pane") return false;
        if (root.children[0] === target) {
          root.children[0] = replacement;
          return true;
        }
        if (root.children[1] === target) {
          root.children[1] = replacement;
          return true;
        }
        return replaceNode(root.children[0], target, replacement) || replaceNode(root.children[1], target, replacement);
      };
      
      if (ws.splitRoot === parentInfo.parent) {
        ws.splitRoot = sibling;
      } else {
        replaceNode(ws.splitRoot, parentInfo.parent, sibling);
      }
      
      const allPanes = this.getAllPanes(ws.splitRoot);
      if (allPanes.length > 0) {
        ws.activePaneId = allPanes[0].id; // Simplified, could focus adjacent
      }
    }

    this.layoutWorkspace(ws);
    this.activeSurface?.terminal.focus();
    this.notify();
  }

  closeActivePane() {
    const ws = this.activeWorkspace;
    const pane = this.activePane;
    if (!ws || !pane) return;
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
    if (!ws) return;
    const panes = this.getAllPanes(ws.splitRoot);
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
    this.zoomedPaneId = this.zoomedPaneId ? null : ws.activePaneId;

    const panes = this.getAllPanes(ws.splitRoot);
    if (this.zoomedPaneId) {
      for (const pane of panes) {
        pane.element.style.display = pane.id === this.zoomedPaneId ? "flex" : "none";
      }
    } else {
      for (const pane of panes) {
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
