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
import { theme, getXtermTheme } from "./theme";
import { openPreview, canPreview, getSupportedExtensions } from "./preview/index";
import { showContextMenu, type MenuItem } from "./context-menu";
import "./preview/init";
import { type WorkspaceDef, type LayoutNode, type SurfaceDef } from "./config";
import "@xterm/xterm/css/xterm.css";

let _id = 0;

/** Safe terminal operations (no-op for markdown surfaces) */
function safeFocus(s: Surface | null | undefined) {
  if (!s?.terminal) return;
  // xterm.js needs the DOM to be settled before it accepts focus
  s.terminal.focus();
  setTimeout(() => s.terminal?.focus(), 30);
  setTimeout(() => s.terminal?.focus(), 100);
}
function safeDispose(s: Surface) {
  if (s.terminal) s.terminal.dispose();
}
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
  cwd?: string;  // last known working directory (from OSC 7)
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
    // Flow control: track pending writes per PTY to avoid flooding xterm.js
    const pendingWrites = new Map<number, number>();
    const PAUSE_THRESHOLD = 5;
    const RESUME_THRESHOLD = 2;

    await listen<{ pty_id: number; data: string }>("pty-output", (event) => {
      const { pty_id, data } = event.payload;
      // Decode base64 to preserve raw terminal escape sequences
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      for (const ws of this.workspaces) {
        for (const s of this.getAllSurfaces(ws)) {
          if (s.ptyId === pty_id && s.terminal) {
            const pending = (pendingWrites.get(pty_id) || 0) + 1;
            pendingWrites.set(pty_id, pending);
            if (pending >= PAUSE_THRESHOLD) {
              invoke("pause_pty", { ptyId: pty_id }).catch(() => {});
            }
            s.terminal.write(bytes, () => {
              const p = Math.max((pendingWrites.get(pty_id) || 0) - 1, 0);
              pendingWrites.set(pty_id, p);
              if (p <= RESUME_THRESHOLD) {
                invoke("resume_pty", { ptyId: pty_id }).catch(() => {});
              }
            });
            return;
          }
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

    // OSC 0/2: shell sets window title (shows process name or custom title)
    await listen<{ pty_id: number; title: string }>("pty-title", (event) => {
      const { pty_id, title } = event.payload;
      for (const ws of this.workspaces) {
        for (const s of this.getAllSurfaces(ws)) {
          if (s.ptyId === pty_id) {
            s.title = title;
            this.notify();
            return;
          }
        }
      }
    });

    // OSC 7: shell reports cwd — use basename as tab title fallback
    await listen<{ pty_id: number; cwd: string }>("pty-cwd", (event) => {
      const { pty_id, cwd } = event.payload;
      for (const ws of this.workspaces) {
        for (const s of this.getAllSurfaces(ws)) {
          if (s.ptyId === pty_id) {
            s.cwd = cwd;
            // Use cwd basename as title if no explicit title was set via OSC 0/2
            const basename = cwd.split("/").pop() || cwd;
            const home = basename || "~";
            if (!s.title || s.title.startsWith("Shell ") || s.title === "~" || !s.title.includes(" ")) {
              s.title = home;
              this.notify();
            }
            return;
          }
        }
      }
    });
  }

  // --- Create Surface (terminal.open called exactly once) ---

  private async createSurface(pane: Pane, cwd?: string): Promise<Surface> {
    let ptyId: number;
    try {
      ptyId = await invoke<number>("spawn_pty", { cols: 80, rows: 24, cwd: cwd ?? null });
    } catch (err) {
      console.error("Failed to spawn PTY:", err);
      ptyId = -1;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: resolvedFontFamily,
      theme: getXtermTheme(),
      allowProposedApi: true,
      scrollback: 5000,
      fastScrollModifier: "alt",
      smoothScrollDuration: 0,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Cmd+click file path detection for preview
    terminal.registerLinkProvider({
      provideLinks: (lineNumber, callback) => {
        const line = terminal.buffer.active.getLine(lineNumber - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString();
        // Match file paths with previewable extensions
        const exts = getSupportedExtensions().join("|");
        // Match: bare filenames, paths, and quoted paths with spaces
        const patterns = [
          `["']([^"']+\\.(?:${exts}))["']`,           // quoted: "my file.md" or 'my file.md'
          `([\\w./~][\\w ./~-]*\\.(?:${exts}))(?=\\s|$)`, // unquoted paths (may have spaces before extension)
        ];
        const regex = new RegExp(patterns.join("|"), "gi");
        const links: any[] = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
          const path = m[1] || m[2]; // group 1 = quoted, group 2 = unquoted
          if (!path) continue;
          const startX = m.index + m[0].indexOf(path);
          links.push({
            range: { start: { x: startX + 1, y: lineNumber }, end: { x: startX + path.length + 1, y: lineNumber } },
            text: path,
            activate: (e: MouseEvent, linkText: string) => {
              // Only open on left-click, not right-click (right-click shows context menu)
              if (e.button !== 0) return;
              // Resolve relative paths against cwd
              let fullPath = linkText;
              if (!linkText.startsWith("/") && surface.cwd) {
                fullPath = `${surface.cwd}/${linkText}`;
              }
              this.openPreview(fullPath);
            },
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    });

    const termElement = document.createElement("div");
    termElement.style.cssText = "flex: 1; min-height: 0; min-width: 0; padding: 2px 4px;";

    const surface: Surface = {
      id: uid(), terminal, fitAddon, termElement, ptyId,
      title: `Shell ${pane.surfaces.length + 1}`,
      hasUnread: false, opened: false,
    };

    terminal.attachCustomKeyEventHandler((e) => {
      // Only intercept Cmd (meta) shortcuts. NEVER intercept Ctrl-only combos
      // (vim, emacs, and other TUI apps need them).
      if (e.type !== "keydown") return true;
      // Ctrl+Tab / Ctrl+Shift+Tab for tab switching
      if (e.ctrlKey && !e.metaKey && e.key === "Tab") return false;

      // Linux: Ctrl+Shift+C = copy, Ctrl+Shift+V = paste
      if (e.ctrlKey && e.shiftKey && !e.metaKey && (e.key === "C" || e.key === "c")) {
        const sel = terminal.getSelection();
        if (sel) navigator.clipboard.writeText(sel);
        return false;
      }
      if (e.ctrlKey && e.shiftKey && !e.metaKey && (e.key === "V" || e.key === "v")) {
        navigator.clipboard.readText().then(text => {
          if (surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data: text });
        });
        return false;
      }

      if (!e.metaKey) return true; // All our shortcuts use Cmd

      const k = e.key.toLowerCase();
      const shift = e.shiftKey;
      const alt = e.altKey;
      const ctrl = e.ctrlKey;

      // ⌘+key (no alt)
      if (!alt && !ctrl) {
        if (["n","t","d","w","b","p","k"].includes(k)) return false;
        if (k >= "1" && k <= "9") return false;
      }
      // ⇧⌘+key
      if (shift && !alt && !ctrl) {
        if (["d","w","h","r","p"].includes(k)) return false;
        if (k === "enter") return false;
        if (k === "[" || k === "]") return false;
      }
      // ⌥⌘+arrows for pane nav
      if (alt && ["arrowleft","arrowright","arrowup","arrowdown"].includes(k)) return false;
      // ⌃⌘ for workspace nav
      if (ctrl && (k === "[" || k === "]")) return false;

      return true;
    });

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

    // OSC 7: shell reports cwd (parsed by xterm.js directly)
    terminal.parser.registerOscHandler(7, (data) => {
      // data is "file://hostname/path"
      let cwd = data;
      if (cwd.startsWith("file://")) {
        const rest = cwd.slice(7); // remove file://
        const slashIdx = rest.indexOf("/");
        if (slashIdx >= 0) cwd = rest.slice(slashIdx);
      }
      surface.cwd = cwd;
      const basename = cwd.split("/").pop() || cwd;
      if (!surface.title || surface.title.startsWith("Shell ") || !surface.title.includes(" ")) {
        surface.title = basename || "~";
        this.notify();
      }
      return true;
    });

    // Context menu on right-click
    termElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const selection = terminal.getSelection();
      const items: MenuItem[] = [];

      // Copy (only if text selected)
      if (selection) {
        items.push({
          label: "Copy",
          shortcut: "⌘C",
          action: () => navigator.clipboard.writeText(selection),
        });
      }

      // Paste
      items.push({
        label: "Paste",
        shortcut: "⌘V",
        action: () => navigator.clipboard.readText().then(t => {
          if (surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data: t });
        }),
      });

      // Check if selection looks like a file path
      const pathText = (selection || "").trim();
      const looksLikePath = pathText && (pathText.startsWith("/") || pathText.startsWith("./") || pathText.startsWith("~/") || pathText.match(/^[\w.-]+\.[a-z]+$/i));

      if (looksLikePath) {
        const fullPath = pathText.startsWith("/") ? pathText :
          pathText.startsWith("~") ? pathText :
          surface.cwd ? `${surface.cwd}/${pathText}` : pathText;

        items.push({ label: "", action: () => {}, separator: true });

        items.push({
          label: "Copy Path",
          action: () => navigator.clipboard.writeText(fullPath),
        });

        if (canPreview(fullPath)) {
          items.push({
            label: "Preview",
            action: () => this.openPreview(fullPath),
          });
        }

        items.push({
          label: "Show in File Manager",
          action: () => invoke("show_in_file_manager", { path: fullPath }),
        });

        items.push({
          label: "Open with Default App",
          action: () => invoke("open_with_default_app", { path: fullPath }),
        });
      }

      items.push({ label: "", action: () => {}, separator: true });

      // Terminal actions
      items.push({
        label: "Clear Scrollback",
        shortcut: "⌘K",
        action: () => terminal.clear(),
      });

      items.push({
        label: "Split Right",
        shortcut: "⌘D",
        action: () => this.splitPane("horizontal"),
      });

      items.push({
        label: "Split Down",
        shortcut: "⇧⌘D",
        action: () => this.splitPane("vertical"),
      });

      showContextMenu(e.clientX, e.clientY, items);
    });

    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;

    return surface;
  }

  private openSurface(surface: Surface) {
    if (surface.opened) return;
    surface.terminal.open(surface.termElement);
    // WebGL renderer is critical for Vim/TUI performance.
    // Must be loaded AFTER terminal.open() when the element is in the DOM.
    const initWebGL = () => {
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          // If WebGL context is lost, the addon auto-disposes.
          // Re-init after a short delay.
          setTimeout(initWebGL, 100);
        });
        surface.terminal.loadAddon(addon);
      } catch (e) {
        console.warn("WebGL renderer failed, using DOM renderer", e);
      }
    };
    // Delay slightly to ensure DOM is settled
    setTimeout(initWebGL, 50);
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
          // Look up fresh references (closures can go stale after rebuilds)
          const currentWs = this.activeWorkspace;
          if (!currentWs) return;
          const currentPane = this.getAllPanes(currentWs.splitRoot).find(p => p.surfaces.includes(s));
          if (!currentPane) return;
          const idx = currentPane.surfaces.indexOf(s);
          if (idx >= 0) this.removeSurface(currentWs, currentPane, idx);
        });
        closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = theme.danger; });
        closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = theme.fgDim; });
        tab.appendChild(closeBtn);

        tab.addEventListener("click", () => {
          const currentWs = this.activeWorkspace;
          if (!currentWs) return;
          const currentPane = this.getAllPanes(currentWs.splitRoot).find(p => p.surfaces.includes(s));
          if (!currentPane) return;
          currentPane.activeSurfaceId = s.id;
          s.hasUnread = false;
          this.buildPaneElement(currentPane, currentWs);
          safeFocus(s);
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
        btn.innerHTML = icon;
        btn.title = title;
        btn.style.cssText = `
          color: ${theme.fgDim}; cursor: pointer; font-size: 16px; line-height: 1;
          width: 24px; height: 24px; border-radius: 4px; 
          display: flex; align-items: center; justify-content: center;
        `;
        btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
        btn.addEventListener("mouseenter", () => {
          btn.style.background = title.includes("Close") ? theme.danger : theme.bgHighlight;
          btn.style.color = title.includes("Close") ? "#ffffff" : theme.fg;
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.background = "transparent";
          btn.style.color = theme.fgDim;
        });
        return btn;
      };

      const svgSplitRight = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="1"/><line x1="7" y1="1" x2="7" y2="13"/></svg>`;
      const svgSplitDown = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="1"/><line x1="1" y1="7" x2="13" y2="7"/></svg>`;
      const svgClose = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>`;

      controls.appendChild(createPaneBtn(svgSplitRight, "Split Right (⌘D)", () => {
        ws.activePaneId = pane.id;
        this.splitPane("horizontal");
      }));
      controls.appendChild(createPaneBtn(svgSplitDown, "Split Down (⇧⌘D)", () => {
        ws.activePaneId = pane.id;
        this.splitPane("vertical");
      }));
      controls.appendChild(createPaneBtn(svgClose, "Close Pane", () => {
        const currentWs = this.activeWorkspace;
        if (!currentWs) return;
        const currentPane = this.getAllPanes(currentWs.splitRoot).find(p => p.id === pane.id);
        if (!currentPane) return;
        this.closeActivePane();
      }));


      tabBar.appendChild(controls);
      el.appendChild(tabBar);

    for (const s of pane.surfaces) {
      this.openSurface(s);
      s.termElement.style.display = s.id === pane.activeSurfaceId ? (s.terminal ? "flex" : "block") : "none";
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
      s.termElement.style.display = s.id === pane.activeSurfaceId ? (s.terminal ? "flex" : "block") : "none";
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
    safeFocus(surface);
    this.notify();
    return ws;
  }

  // --- Create workspace from cmux config definition ---

  async createWorkspaceFromDef(def: WorkspaceDef): Promise<Workspace> {
    const wsElement = document.createElement("div");
    wsElement.style.cssText = "flex: 1; display: flex; min-height: 0; min-width: 0;";

    const wsName = def.name || `Workspace ${this.workspaces.length + 1}`;
    const rootCwd = def.cwd;

    const ws: Workspace = {
      id: uid(), name: wsName,
      splitRoot: { type: "pane", pane: { id: "dummy", surfaces: [], activeSurfaceId: null, element: document.createElement("div") } },
      activePaneId: null, element: wsElement,
    };

    this.workspaces.push(ws);
    this.switchWorkspace(this.workspaces.length - 1);

    // Recursively build the tree
    const buildTree = async (nodeDef: LayoutNode, inheritedCwd?: string): Promise<SplitNode> => {
      if ("pane" in nodeDef) {
        const paneEl = document.createElement("div");
        const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };
        if (!ws.activePaneId) ws.activePaneId = pane.id;

        for (const sDef of nodeDef.pane.surfaces) {
          const cwd = sDef.cwd || inheritedCwd;
          if (sDef.type === "markdown" && sDef.path) {
            const preview = await openPreview(sDef.path);
            const surface: Surface = {
              id: preview.id, terminal: null as any, fitAddon: { fit: () => {} } as any,
              termElement: preview.element, ptyId: -1, title: sDef.name || preview.title,
              cwd, hasUnread: false, opened: true,
            };
            pane.surfaces.push(surface);
            if (!pane.activeSurfaceId || sDef.focus) pane.activeSurfaceId = surface.id;
          } else {
            const surface = await this.createSurface(pane, cwd);
            if (sDef.name) {
              surface.title = sDef.name;
              // Override xterm listener from overwriting
              if (surface.terminal) {
                surface.terminal.onTitleChange(() => { /* ignore */ });
              }
            }
            if (sDef.command) {
              // Give shell time to initialize before sending command
              setTimeout(() => {
                invoke("write_pty", { ptyId: surface.ptyId, data: `${sDef.command}\n` }).catch(() => {});
              }, 500);
            }
            if (!pane.activeSurfaceId || sDef.focus) pane.activeSurfaceId = surface.id;
          }
        }

        if (pane.surfaces.length === 0) {
          const surface = await this.createSurface(pane, inheritedCwd);
          pane.activeSurfaceId = surface.id;
        }

        return { type: "pane", pane };
      } else {
        const left = await buildTree(nodeDef.children[0], inheritedCwd);
        const right = await buildTree(nodeDef.children[1], inheritedCwd);
        return {
          type: "split",
          direction: nodeDef.direction,
          ratio: nodeDef.split || 0.5,
          children: [left, right],
        };
      }
    };

    if (def.layout) {
      ws.splitRoot = await buildTree(def.layout, rootCwd);
    } else {
      // Default single pane if no layout specified
      const paneEl = document.createElement("div");
      const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null, element: paneEl };
      await this.createSurface(pane, rootCwd);
      pane.activeSurfaceId = pane.surfaces[0].id;
      ws.splitRoot = { type: "pane", pane };
      ws.activePaneId = pane.id;
    }

    this.layoutWorkspace(ws);
    const activePane = this.getAllPanes(ws.splitRoot).find(p => p.id === ws.activePaneId);
    const activeSurface = activePane?.surfaces.find(s => s.id === activePane.activeSurfaceId);
    setTimeout(() => safeFocus(activeSurface), 50);
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
      safeFocus(surface);
    }, 20);
    this.notify();
  }

  closeActiveWorkspace() {
    if (this.workspaces.length <= 1) return;
    const ws = this.workspaces[this.activeWorkspaceIdx];
    for (const s of this.getAllSurfaces(ws)) {
      safeDispose(s);
      if (s.ptyId >= 0) invoke("kill_pty", { ptyId: s.ptyId }).catch(() => {});
    }
    ws.element.remove();
    this.workspaces.splice(this.activeWorkspaceIdx, 1);
    this.switchWorkspace(Math.min(this.activeWorkspaceIdx, this.workspaces.length - 1));
  }

  // --- Surface Management ---

  getActiveCwd(): string | undefined {
    return this.activeSurface?.cwd;
  }

  async newSurface(ws?: Workspace, pane?: Pane) {
    ws = ws ?? this.activeWorkspace ?? undefined;
    pane = pane ?? this.activePane ?? undefined;
    if (!ws || !pane) return;

    const cwd = this.getActiveCwd();
    await this.createSurface(pane, cwd);
    this.buildPaneElement(pane, ws);
    const surface = pane.surfaces.find((s) => s.id === pane!.activeSurfaceId);
    // Delay focus — xterm.js needs DOM to settle after rebuild
    setTimeout(() => safeFocus(surface), 50);
    this.notify();
  }

  nextSurface() {
    const pane = this.activePane;
    const ws = this.activeWorkspace;
    if (!pane || !ws || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx + 1) % pane.surfaces.length].id;
    this.buildPaneElement(pane, ws);
    safeFocus(this.activeSurface);
    this.notify();
  }

  prevSurface() {
    const pane = this.activePane;
    const ws = this.activeWorkspace;
    if (!pane || !ws || pane.surfaces.length <= 1) return;
    const idx = pane.surfaces.findIndex((s) => s.id === pane.activeSurfaceId);
    pane.activeSurfaceId = pane.surfaces[(idx - 1 + pane.surfaces.length) % pane.surfaces.length].id;
    this.buildPaneElement(pane, ws);
    safeFocus(this.activeSurface);
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
      safeFocus(this.activeSurface);
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
    safeDispose(surface);
    surface.termElement.remove();
    if (surface.ptyId >= 0) invoke("kill_pty", { ptyId: surface.ptyId }).catch(() => {});
    pane.surfaces.splice(surfaceIdx, 1);

    if (pane.surfaces.length === 0) {
      this.removePane(ws, pane);
    } else {
      pane.activeSurfaceId = pane.surfaces[Math.min(surfaceIdx, pane.surfaces.length - 1)].id;
      this.buildPaneElement(pane, ws);
      const s = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
      safeFocus(s);
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
    const cwd = this.getActiveCwd();
    await this.createSurface(newPane, cwd);

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
    safeFocus(surface);
    this.notify();
  }

  private removePane(ws: Workspace, pane: Pane) {
    pane.element.remove();
    
    if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
      // Last pane gone — close the workspace
      ws.element.remove();
      const wsIdx = this.workspaces.indexOf(ws);
      if (wsIdx >= 0) this.workspaces.splice(wsIdx, 1);
      
      if (this.workspaces.length === 0) {
        this.createWorkspace("Workspace 1");
      } else {
        this.switchWorkspace(Math.min(wsIdx, this.workspaces.length - 1));
      }
      this.notify();
      return;
    }
    
    const parentInfo = this.findParentSplit(ws.splitRoot, pane.id);
    if (parentInfo && parentInfo.parent.type === "split") {
      const parent = parentInfo.parent;
      const sibling = parent.children[parentInfo.index === 0 ? 1 : 0];
      
      // Replace the parent split with the sibling in the tree
      
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
    safeFocus(this.activeSurface);
    this.notify();
  }

  closeActivePane() {
    const ws = this.activeWorkspace;
    const pane = this.activePane;
    if (!ws || !pane) return;
    for (const s of [...pane.surfaces]) {
      safeDispose(s);
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
    safeFocus(surface);
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
    safeFocus(this.activeSurface);
    this.notify();
  }

  // --- Flash ---

  /** Open a file preview in a new tab */
  async openPreview(filePath: string) {
    const ws = this.activeWorkspace;
    const pane = this.activePane;
    if (!ws || !pane) return;

    const preview = await openPreview(filePath);

    const surface: Surface = {
      id: preview.id,
      terminal: null as any,
      fitAddon: { fit: () => {} } as any,
      termElement: preview.element,
      ptyId: -1,
      title: preview.title,
      notification: undefined,
      hasUnread: false,
      opened: true,
    };

    pane.surfaces.push(surface);
    pane.activeSurfaceId = surface.id;
    this.buildPaneElement(pane, ws);
    this.notify();
  }

  /** Check if a file can be previewed */
  canPreview(filePath: string): boolean {
    return canPreview(filePath);
  }

  flashFocusedPane() {
    const pane = this.activePane;
    if (!pane?.element) return;
    const el = pane.element;
    el.style.boxShadow = `inset 0 0 0 2px ${theme.accent}, 0 0 12px ${theme.notifyGlow}`;
    setTimeout(() => { el.style.boxShadow = "none"; }, 400);
  }

  /** Serialize a split tree to a config-compatible layout definition */
  serializeLayout(node: SplitNode): any {
    if (node.type === "pane") {
      const surfaces = node.pane.surfaces.map(s => {
        const def: any = { type: "terminal" };
        if (s.title) def.name = s.title;
        if (s.cwd) def.cwd = s.cwd;
        if (s.id === node.pane.activeSurfaceId) def.focus = true;
        return def;
      });
      return { pane: { surfaces } };
    }
    return {
      direction: node.direction,
      split: node.ratio,
      children: [
        this.serializeLayout(node.children[0]),
        this.serializeLayout(node.children[1]),
      ],
    };
  }

  /** Re-layout all workspaces (called after theme change) */
  refreshLayout() {
    const ws = this.activeWorkspace;
    if (ws) {
      this.layoutWorkspace(ws);
    }
    this.notify();
  }
}
