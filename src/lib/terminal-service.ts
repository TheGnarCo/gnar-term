/**
 * Terminal Service — PTY lifecycle, flow control, and surface creation.
 *
 * Extracted from the old TerminalManager class for use with Svelte stores.
 * This module owns all non-DOM terminal logic: spawning PTYs, buffering output,
 * creating TerminalSurface objects, and opening terminals with WebGL.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText as clipboardRead, writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { get } from "svelte/store";
import { xtermTheme } from "./stores/theme";
import { workspaces, activeWorkspaceIdx } from "./stores/workspace";
import { contextMenu, pendingAction } from "./stores/ui";
import { canPreview, getSupportedExtensions, openPreview } from "../preview/index";
import type { TerminalSurface, Pane, Surface, Workspace } from "./types";
import { uid, getAllSurfaces, getAllPanes, isTerminalSurface, findParentSplit, replaceNodeInTree } from "./types";
import type { MenuItem } from "./context-menu-types";
import { createResizeHandler, markWriteStart, markWriteEnd, setupScrollAnchor } from "./resize-guard";
import "@xterm/xterm/css/xterm.css";

/** Platform detection — used for Cmd (macOS) vs Ctrl (Linux/Windows) shortcuts. */
export const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

/** Shortcut label helpers for platform-appropriate display. */
export const modLabel = isMac ? "⌘" : "Ctrl+";
export const shiftModLabel = isMac ? "⇧⌘" : "Ctrl+Shift+";

/** Resolve a link path to an absolute filesystem path. Expands ~ and prepends cwd for relative paths. */
export async function resolveFilePath(linkText: string, cwd: string | undefined): Promise<string> {
  if (linkText.startsWith("/")) return linkText;
  if (linkText.startsWith("~/")) {
    try {
      const home = await invoke<string>("get_home");
      return home + linkText.slice(1);
    } catch {
      return linkText;
    }
  }
  if (cwd) {
    const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
    return `${base}/${linkText}`;
  }
  return linkText;
}

// --- Font Detection ---

const BUNDLED_FONT = '"JetBrainsMono Nerd Font Mono"';
const SYSTEM_FALLBACK = 'Menlo, "DejaVu Sans Mono", monospace';
export let resolvedFontFamily = `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;

async function detectFont(): Promise<string> {
  try {
    const font = await invoke<string>("detect_font");
    if (font) {
      return `"${font}", ${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
    }
  } catch (_) {
    // Font detection not available — use bundled font
  }
  return `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
}

export const fontReady = detectFont().then((f) => { resolvedFontFamily = f; });

// --- Flow Control ---

const ptyBuffers = new Map<number, Uint8Array[]>();
const ptyBufferBytes = new Map<number, number>();
const ptyFlushScheduled = new Set<number>();
const ptyPaused = new Set<number>();

const BUFFER_HIGH_WATER = 128 * 1024; // 128KB
const BUFFER_LOW_WATER = 32 * 1024;   // 32KB

function findSurfaceByPty(ptyId: number): TerminalSurface | null {
  const wsList = get(workspaces);
  for (const ws of wsList) {
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s) && s.ptyId === ptyId) return s;
    }
  }
  return null;
}

function scheduleFlush(ptyId: number) {
  if (ptyFlushScheduled.has(ptyId)) return;
  ptyFlushScheduled.add(ptyId);
  requestAnimationFrame(() => flushPtyBuffer(ptyId));
}

function flushPtyBuffer(ptyId: number) {
  ptyFlushScheduled.delete(ptyId);
  const chunks = ptyBuffers.get(ptyId);
  if (!chunks || chunks.length === 0) return;

  const surface = findSurfaceByPty(ptyId);
  if (!surface) {
    // Surface gone — discard buffered data and resume PTY so reader thread exits
    ptyBuffers.delete(ptyId);
    ptyBufferBytes.delete(ptyId);
    if (ptyPaused.has(ptyId)) {
      ptyPaused.delete(ptyId);
      invoke("resume_pty", { ptyId }).catch(() => {});
    }
    return;
  }

  // Concatenate all buffered chunks into one write
  const totalBytes = ptyBufferBytes.get(ptyId) || 0;
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  ptyBufferBytes.set(ptyId, 0);

  // Mark write as in-flight so the onScroll handler (in resize-guard.ts) can
  // distinguish auto-scrolls from user scrolls and counteract them (#46).
  markWriteStart(ptyId);

  // Single write to xterm.js per frame — the callback fires when xterm.js has
  // processed this batch, which is our signal that it's ready for more.
  surface.terminal.write(merged, () => {
    markWriteEnd(ptyId);
    // If more data arrived while we were rendering, flush again next frame
    const buffered = ptyBufferBytes.get(ptyId) || 0;
    if (buffered > 0) {
      scheduleFlush(ptyId);
    }
    // Resume PTY reader if we drained below low water mark
    if (ptyPaused.has(ptyId) && buffered < BUFFER_LOW_WATER) {
      ptyPaused.delete(ptyId);
      invoke("resume_pty", { ptyId }).catch(() => {});
    }
  });
}

// --- Event Listeners ---

export async function setupListeners() {
  // On Linux, prevent WebKitGTK from intercepting Ctrl+Shift+C/V before xterm.js
  if (!isMac) {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "C" || e.key === "c" || e.key === "V" || e.key === "v")) {
        e.preventDefault();
      }
    }, { capture: true });
  }
  await listen<{ pty_id: number; data: string }>("pty-output", (event) => {
    const { pty_id, data } = event.payload;
    // Decode base64 to preserve raw terminal escape sequences
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    // Append to buffer
    let chunks = ptyBuffers.get(pty_id);
    if (!chunks) {
      chunks = [];
      ptyBuffers.set(pty_id, chunks);
    }
    chunks.push(bytes);
    const buffered = (ptyBufferBytes.get(pty_id) || 0) + bytes.length;
    ptyBufferBytes.set(pty_id, buffered);

    // Pause PTY reader if buffer is getting large
    if (!ptyPaused.has(pty_id) && buffered >= BUFFER_HIGH_WATER) {
      ptyPaused.add(pty_id);
      invoke("pause_pty", { ptyId: pty_id }).catch(() => {});
    }

    // Schedule a flush on the next animation frame
    scheduleFlush(pty_id);
  });

  await listen<{ pty_id: number }>("pty-exit", (event) => {
    const { pty_id } = event.payload;
    // Clean up flow control state for the dead PTY
    ptyBuffers.delete(pty_id);
    ptyBufferBytes.delete(pty_id);
    ptyFlushScheduled.delete(pty_id);
    ptyPaused.delete(pty_id);

    // Remove the surface from its pane, and collapse empty panes
    let needsDefaultWorkspace = false;
    workspaces.update((wsList) => {
      for (const ws of wsList) {
        for (const pane of getAllPanes(ws.splitRoot)) {
          const idx = pane.surfaces.findIndex(
            (s) => isTerminalSurface(s) && s.ptyId === pty_id
          );
          if (idx >= 0) {
            pane.surfaces.splice(idx, 1);
            if (pane.surfaces.length > 0) {
              pane.activeSurfaceId = pane.surfaces[Math.min(idx, pane.surfaces.length - 1)].id;
            } else {
              // Pane is empty — collapse it from the split tree
              pane.activeSurfaceId = null;
              pane.resizeObserver?.disconnect();
              if (ws.splitRoot.type === "pane" && ws.splitRoot.pane.id === pane.id) {
                // This was the only pane in the workspace — remove the workspace
                const wsIdx = wsList.indexOf(ws);
                wsList.splice(wsIdx, 1);
                const currentIdx = get(activeWorkspaceIdx);
                if (currentIdx >= wsList.length) {
                  activeWorkspaceIdx.set(Math.max(0, wsList.length - 1));
                }
                if (wsList.length === 0) {
                  needsDefaultWorkspace = true;
                }
                return wsList;
              }
              // Find parent split and collapse it
              const parentInfo = findParentSplit(ws.splitRoot, pane.id);
              if (parentInfo && parentInfo.parent.type === "split") {
                const sibling = parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
                if (ws.splitRoot === parentInfo.parent) {
                  ws.splitRoot = sibling;
                } else {
                  replaceNodeInTree(ws.splitRoot, parentInfo.parent, sibling);
                }
                ws.activePaneId = getAllPanes(ws.splitRoot)[0]?.id ?? null;
              }
            }
            return wsList;
          }
        }
      }
      return wsList;
    });
    if (needsDefaultWorkspace) {
      createDefaultWorkspace();
    }
  });

  await listen<{ pty_id: number; text: string }>("pty-notification", (event) => {
    const { pty_id, text } = event.payload;
    // Filter out escape-sequence fragments that slipped through (e.g. "4;0;")
    if (/^\d+[;\d:\/]*$/.test(text) || !text.trim()) return;
    workspaces.update((wsList) => {
      for (const ws of wsList) {
        for (const s of getAllSurfaces(ws)) {
          if (isTerminalSurface(s) && s.ptyId === pty_id) {
            s.notification = text;
            s.hasUnread = true;
            return wsList;
          }
        }
      }
      return wsList;
    });
  });

  // OSC 0/2: shell sets window title (shows process name or custom title)
  await listen<{ pty_id: number; title: string }>("pty-title", (event) => {
    const { pty_id, title } = event.payload;
    // Filter out escape-sequence fragments that may slip through
    if (!title || /[\x00-\x1f\x7f]/.test(title) || /^\d+[;\d:\/]*$/.test(title)) return;
    workspaces.update((wsList) => {
      for (const ws of wsList) {
        for (const s of getAllSurfaces(ws)) {
          if (isTerminalSurface(s) && s.ptyId === pty_id) {
            s.title = title;
            return wsList;
          }
        }
      }
      return wsList;
    });
  });
}

// --- CWD Polling Fallback ---
// For shells that don't emit OSC 7, poll get_pty_cwd periodically
let cwdPollTimer: ReturnType<typeof setInterval> | null = null;

export function startCwdPolling() {
  if (cwdPollTimer) return;
  cwdPollTimer = setInterval(() => {
    const wsList = get(workspaces);
    for (const ws of wsList) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s) && s.ptyId >= 0) {
          invoke<string>("get_pty_cwd", { ptyId: s.ptyId })
            .then(cwd => {
              if (cwd && cwd !== s.cwd) {
                s.cwd = cwd;
                const basename = cwd.split("/").pop() || cwd;
                if (!s.title || s.title.startsWith("Shell ")) {
                  s.title = basename || "~";
                  workspaces.update(l => [...l]);
                }
              }
            })
            .catch(() => {});
        }
      }
    }
  }, 5000); // Poll every 5 seconds
}

// --- Default Workspace Recovery ---

export async function createDefaultWorkspace() {
  const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
  const ws: Workspace = {
    id: uid(),
    name: "Workspace 1",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
  };
  await createTerminalSurface(pane);
  workspaces.update(list => [...list, ws]);
  activeWorkspaceIdx.set(0);
}

// --- Surface Creation ---

export async function createTerminalSurface(pane: Pane, cwd?: string): Promise<TerminalSurface> {
  const ptyId = -1; // PTY spawned later via connectPty() after fit()

  const currentXtermTheme = get(xtermTheme);

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: resolvedFontFamily,
    theme: currentXtermTheme,
    allowProposedApi: true,
    scrollback: 5000,
    smoothScrollDuration: 0,
    fastScrollModifier: "alt",
    vtExtensions: {
      kittyKeyboard: true,
    },
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.loadAddon(searchAddon);

  const termElement = document.createElement("div");
  termElement.style.cssText = "flex: 1; min-height: 0; min-width: 0; padding: 2px 4px;";

  const surface: TerminalSurface = {
    kind: "terminal",
    id: uid(), terminal, fitAddon, searchAddon, termElement, ptyId,
    title: `Shell ${pane.surfaces.length + 1}`,
    cwd: cwd,
    hasUnread: false, opened: false,
  };

  // Cmd+click file path detection for preview
  terminal.registerLinkProvider({
    provideLinks: (lineNumber, callback) => {
      const line = terminal.buffer.active.getLine(lineNumber - 1);
      if (!line) { callback(undefined); return; }
      const text = line.translateToString();
      const exts = getSupportedExtensions().join("|");
      const patterns = [
        `"([^"]+\\.(?:${exts}))"`,
        `'([^']+\\.(?:${exts}))'`,
        `((?:/|\\./|~/)\\S[\\S ]*\\.(?:${exts}))(?=\\s|$)`,
        `(\\S+\\.(?:${exts}))(?=\\s|$)`,
      ];
      const regex = new RegExp(patterns.join("|"), "gi");
      const candidates: { path: string; startX: number; endX: number }[] = [];

      let m;
      while ((m = regex.exec(text)) !== null) {
        const path = m[1] || m[2] || m[3] || m[4];
        if (!path) continue;
        const startX = m.index + m[0].indexOf(path);
        candidates.push({ path, startX, endX: startX + path.length });
      }

      if (candidates.length === 0) { callback(undefined); return; }

      Promise.all(
        candidates.map(async (c) => {
          const fullPath = await resolveFilePath(c.path, surface.cwd);
          const exists = await invoke<boolean>("file_exists", { path: fullPath });
          if (!exists) return null;
          return {
            range: { start: { x: c.startX + 1, y: lineNumber }, end: { x: c.endX + 1, y: lineNumber } },
            text: c.path,
            activate: async (e: MouseEvent, linkText: string) => {
              if (e.button !== 0) return;
              const resolved = await resolveFilePath(linkText, surface.cwd);
              pendingAction.set({ type: "open-preview", payload: resolved });
            },
          };
        })
      ).then((results) => {
        const links = results.filter((r): r is NonNullable<typeof r> => r !== null);
        callback(links.length > 0 ? links : undefined);
      });
    },
  });

  // Key handler — intercept Cmd/Ctrl shortcuts, pass everything else to PTY
  terminal.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    // Ctrl+Tab / Ctrl+Shift+Tab for tab switching
    if (e.ctrlKey && !e.metaKey && e.key === "Tab") return false;

    // Linux: Ctrl+Shift+C = copy, Ctrl+Shift+V = paste
    // Uses Tauri clipboard plugin because webview clipboard access isn't guaranteed.
    if (e.ctrlKey && e.shiftKey && !e.metaKey && (e.key === "C" || e.key === "c")) {
      const sel = terminal.getSelection();
      if (sel) clipboardWrite(sel);
      return false;
    }
    if (e.ctrlKey && e.shiftKey && !e.metaKey && (e.key === "V" || e.key === "v")) {
      e.preventDefault();
      clipboardRead().then(text => {
        if (text && surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data: text });
      });
      return false;
    }

    // On macOS, intercept Cmd (meta) shortcuts. On Linux, NEVER intercept
    // Ctrl-only combos — vim, emacs, readline, and TUI apps need Ctrl+C (SIGINT),
    // Ctrl+D (EOF), Ctrl+W (delete word), Ctrl+K (kill line), etc.
    // Linux app shortcuts use Ctrl+Shift instead.
    if (isMac) {
      if (!e.metaKey) return true; // Only intercept Cmd shortcuts on macOS

      const k = e.key.toLowerCase();
      const shift = e.shiftKey;
      const alt = e.altKey;

      // Cmd+C — copy selection
      if (!alt && !shift && k === "c") {
        const sel = terminal.getSelection();
        if (sel) clipboardWrite(sel);
        return false;
      }
      // Cmd+V — paste
      if (!alt && !shift && k === "v") {
        e.preventDefault();
        clipboardRead().then(text => {
          if (text && surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data: text });
        }).catch((err) => console.warn("Clipboard read failed:", err));
        return false;
      }

      // Cmd+key (no alt) — let App.svelte handle
      if (!alt && !shift) {
        if (["n","t","d","w","b","p","k","f","g"].includes(k)) return false;
        if (k >= "1" && k <= "9") return false;
      }
      // Shift+Cmd+key
      if (shift && !alt) {
        if (["d","w","h","r","p","g","t"].includes(k)) return false;
        if (k === "enter") return false;
        if (k === "[" || k === "]") return false;
      }
      // Alt+Cmd+arrows for pane nav
      if (alt && ["arrowleft","arrowright","arrowup","arrowdown"].includes(k)) return false;
    } else {
      // Linux/Windows: only intercept Ctrl+Shift combos for app shortcuts.
      // Plain Ctrl+key passes through to PTY for TUI apps.
      if (!e.ctrlKey || !e.shiftKey) return true;

      const k = e.key.toLowerCase();
      const alt = e.altKey;
      // Ctrl+Shift+key — let App.svelte handle app shortcuts
      if (!alt) {
        if (["n","t","d","w","b","p","k","f","g","h","r"].includes(k)) return false;
        if (k === "enter") return false;
        if (k === "[" || k === "]") return false;
      }
    }

    return true;
  });

  terminal.onData((data) => {
    if (surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data });
  });
  terminal.onResize(createResizeHandler(() => surface.ptyId));
  // NOTE: We intentionally do NOT use terminal.onTitleChange() here.
  // xterm.js fires it with raw/partial escape sequence fragments (OSC 7 cwd data,
  // bracketed paste mode, etc.) concatenated into the title string. Instead, the
  // Rust backend parses OSC 0/2 cleanly and emits "pty-title" events (handled in
  // setupListeners), and OSC 7 cwd is handled by the registerOscHandler below.

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
        shortcut: isMac ? "⌘C" : "Ctrl+Shift+C",
        action: () => clipboardWrite(selection),
      });
    }

    // Paste
    items.push({
      label: "Paste",
      shortcut: isMac ? "⌘V" : "Ctrl+Shift+V",
      action: () => clipboardRead().then(t => {
        if (t && surface.ptyId >= 0) invoke("write_pty", { ptyId: surface.ptyId, data: t });
      }),
    });

    // Check if selection looks like a file path
    const pathText = (selection || "").trim();
    const looksLikePath = pathText && (pathText.startsWith("/") || pathText.startsWith("./") || pathText.startsWith("~/") || pathText.match(/^[\w.-]+\.[a-z]+$/i));

    if (looksLikePath) {
      const resolvePath = () => resolveFilePath(pathText, surface.cwd);

      items.push({ label: "", action: () => {}, separator: true });

      items.push({
        label: "Copy Path",
        action: async () => clipboardWrite(await resolvePath()),
      });

      if (canPreview(pathText)) {
        items.push({
          label: "Preview",
          action: async () => openPreview(await resolvePath()),
        });
      }

      items.push({
        label: "Show in File Manager",
        action: async () => invoke("show_in_file_manager", { path: await resolvePath() }),
      });

      items.push({
        label: "Open with Default App",
        action: async () => invoke("open_with_default_app", { path: await resolvePath() }),
      });
    }

    items.push({ label: "", action: () => {}, separator: true });

    // Terminal actions
    items.push({
      label: "Clear Scrollback",
      shortcut: `${modLabel}K`,
      action: () => terminal.clear(),
    });

    items.push({
      label: "Split Right",
      shortcut: `${modLabel}D`,
      action: () => pendingAction.set({ type: "split-right" }),
    });

    items.push({
      label: "Split Down",
      shortcut: `${shiftModLabel}D`,
      action: () => pendingAction.set({ type: "split-down" }),
    });

    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  });

  // Scroll anchor: intercept auto-scrolls during write() via onScroll handler,
  // and track user scrolls to set/clear the anchor (#46).
  setupScrollAnchor(terminal, () => surface.ptyId);

  pane.surfaces.push(surface);
  pane.activeSurfaceId = surface.id;

  return surface;
}

/** Spawn the PTY for a surface. Called after terminal.open() + fit() so the PTY
 *  gets the real terminal dimensions instead of hardcoded 80x24.
 *  Uses surface.cwd as the working directory. The optional cwd parameter is
 *  accepted for backwards compatibility but surface.cwd takes priority. */
export async function connectPty(surface: TerminalSurface, cwd?: string): Promise<void> {
  if (surface.ptyId >= 0) return; // already connected
  const cols = surface.terminal.cols;
  const rows = surface.terminal.rows;
  const effectiveCwd = surface.cwd || cwd || null;
  try {
    surface.ptyId = await invoke<number>("spawn_pty", { cols, rows, cwd: effectiveCwd });
  } catch (err) {
    console.error("Failed to spawn PTY:", err);
    surface.ptyId = -1;
  }
}

