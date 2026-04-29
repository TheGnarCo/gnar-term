/**
 * Terminal Service — PTY lifecycle, flow control, and surface creation.
 *
 * Extracted from the old TerminalManager class for use with Svelte stores.
 * This module owns all non-DOM terminal logic: spawning PTYs, buffering output,
 * creating TerminalSurface objects, and opening terminals with WebGL.
 */

import { Terminal } from "@xterm/xterm";
import type { ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { appendMcpOutput } from "./services/mcp-output-buffer";
import { eventBus } from "./services/event-bus";
import { notifyOutputObservers } from "./services/surface-output-observer";
import { getConfig, saveConfig } from "./config";
import {
  readText as clipboardRead,
  writeText as clipboardWrite,
} from "@tauri-apps/plugin-clipboard-manager";
import {
  lookupTerminalByPtyId,
  registerPtyForSurface,
} from "./services/service-helpers";
import {
  isPermissionGranted as notifPermissionGranted,
  requestPermission as notifRequestPermission,
  sendNotification as notifSend,
} from "@tauri-apps/plugin-notification";
import { get } from "svelte/store";
import { xtermTheme } from "./stores/theme";
import { workspaces, activeWorkspaceIdx } from "./stores/workspace";
import { contextMenu, pendingAction } from "./stores/ui";
import {
  getRegisteredFileExtensions,
  getContextMenuItemsForFile,
} from "./services/context-menu-item-registry";
import type { TerminalSurface, Pane, Workspace } from "./types";
import {
  uid,
  getAllSurfaces,
  getAllPanes,
  isTerminalSurface,
  findParentSplit,
  replaceNodeInTree,
} from "./types";
import type { MenuItem } from "./context-menu-types";
import "@xterm/xterm/css/xterm.css";

/** Platform detection — used for Cmd (macOS) vs Ctrl (Linux/Windows) shortcuts. */
export const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

// Per-surface PTY-ready signal. connectPty() resolves the deferred once the
// Rust spawn_pty call returns; waitForPtyReady() awaits it instead of polling
// surface.ptyId every 50ms. The polling version created a 50ms timer storm
// during spawn bursts that contributed to a compositor freeze.
interface PtyReadyDeferred {
  promise: Promise<number>;
  resolve: (ptyId: number) => void;
  reject: (err: Error) => void;
}
const ptyReady = new Map<string, PtyReadyDeferred>();

function makeDeferred(): PtyReadyDeferred {
  let resolve!: (n: number) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function waitForPtyReady(
  surface: TerminalSurface,
  timeoutMs = 5000,
): Promise<number> {
  if (surface.ptyId >= 0) return Promise.resolve(surface.ptyId);
  let d = ptyReady.get(surface.id);
  if (!d) {
    d = makeDeferred();
    ptyReady.set(surface.id, d);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timed out waiting for PTY to spawn"));
    }, timeoutMs);
    d!.promise.then(
      (n) => {
        clearTimeout(timer);
        resolve(n);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Shortcut label helpers for platform-appropriate display. */
export const modLabel = isMac ? "⌘" : "Ctrl+";
export const shiftModLabel = isMac ? "⇧⌘" : "Ctrl+Shift+";

/** Resolve a link path to an absolute filesystem path. Expands ~ and prepends cwd for relative paths. */
export async function resolveFilePath(
  linkText: string,
  cwd: string | undefined,
): Promise<string> {
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
  } catch {
    // Font detection not available — use bundled font
  }
  return `${BUNDLED_FONT}, ${SYSTEM_FALLBACK}`;
}

export const fontReady = detectFont().then((f) => {
  resolvedFontFamily = f;
});

// --- Flow Control ---

const ptyBuffers = new Map<number, Uint8Array[]>();
const ptyBufferBytes = new Map<number, number>();
const ptyFlushScheduled = new Set<number>();
const ptyPaused = new Set<number>();

const BUFFER_HIGH_WATER = 128 * 1024; // 128KB
const BUFFER_LOW_WATER = 32 * 1024; // 32KB

function findSurfaceByPty(ptyId: number): TerminalSurface | null {
  return lookupTerminalByPtyId(ptyId) ?? null;
}

function scheduleFlush(ptyId: number) {
  if (ptyFlushScheduled.has(ptyId)) return;
  ptyFlushScheduled.add(ptyId);
  requestAnimationFrame(() => flushPtyBuffer(ptyId));
}

// --- First-PTY-output hooks ---

/** Set of ptyIds that have ever emitted at least one byte of output.
 *  Used by onFirstPtyOutput to fire the callback immediately when the
 *  pty is already known to have produced output (avoids a lost-callback
 *  race when output arrives during connectPty's pending-bytes replay). */
const ptyHasOutput = new Set<number>();

/** Per-pty set of first-output listener callbacks. Drained on first chunk. */
const firstOutputListeners = new Map<number, Set<() => void>>();

/**
 * Register a one-shot callback that fires the first time output arrives
 * for `ptyId`. If this pty has already emitted output the callback is
 * scheduled immediately via queueMicrotask.
 *
 * Returns an unsubscribe function. Calling it cancels the callback if it
 * has not fired yet; safe to call multiple times.
 */
export function onFirstPtyOutput(
  ptyId: number,
  callback: () => void,
): () => void {
  if (ptyHasOutput.has(ptyId)) {
    // Already seen output — fire immediately but asynchronously.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) callback();
    });
    return () => {
      cancelled = true;
    };
  }

  let listeners = firstOutputListeners.get(ptyId);
  if (!listeners) {
    listeners = new Set();
    firstOutputListeners.set(ptyId, listeners);
  }
  listeners.add(callback);

  return () => {
    const set = firstOutputListeners.get(ptyId);
    if (set) {
      set.delete(callback);
      if (set.size === 0) firstOutputListeners.delete(ptyId);
    }
  };
}

/** Drain any registered first-output listeners for `ptyId`. Called from
 *  handlePtyChunk on the first chunk. */
function drainFirstOutputListeners(ptyId: number): void {
  const listeners = firstOutputListeners.get(ptyId);
  if (!listeners) return;
  firstOutputListeners.delete(ptyId);
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore listener errors */
    }
  }
}

/** Append a raw PTY chunk to the per-pty buffer, tee it to the MCP buffer
 *  if one is registered, and schedule an rAF flush to xterm.js. Exported for
 *  tests; in production this is called from the Channel onmessage handler
 *  created in connectPty(). */
export function handlePtyChunk(ptyId: number, bytes: Uint8Array): void {
  // Fire first-output listeners on the very first chunk.
  if (!ptyHasOutput.has(ptyId)) {
    ptyHasOutput.add(ptyId);
    drainFirstOutputListeners(ptyId);
  }

  let chunks = ptyBuffers.get(ptyId);
  if (!chunks) {
    chunks = [];
    ptyBuffers.set(ptyId, chunks);
  }
  chunks.push(bytes);
  const buffered = (ptyBufferBytes.get(ptyId) || 0) + bytes.length;
  ptyBufferBytes.set(ptyId, buffered);

  if (!ptyPaused.has(ptyId) && buffered >= BUFFER_HIGH_WATER) {
    ptyPaused.add(ptyId);
    invoke("pause_pty", { ptyId }).catch(() => {});
  }

  appendMcpOutput(ptyId, bytes);
  // Fan out to surface output observers (passive agent detection, etc.).
  // notifyOutputObservers is a no-op when no observer is registered for
  // the pty. Non-streaming decode — all agent-detection consumers match
  // on ASCII (pattern names, OSC numbers), and a single shared stream
  // decoder would corrupt state across interleaved ptys.
  notifyOutputObservers(ptyId, ptyTextDecoder.decode(bytes));
  scheduleFlush(ptyId);
}

const ptyTextDecoder = new TextDecoder("utf-8", { fatal: false });

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
      invoke("resume_pty", { ptyId })
        .then(() => {
          ptyPaused.delete(ptyId);
        })
        .catch((err) => {
          console.error(
            "[terminal-service] resume_pty failed, terminal may hang:",
            err,
          );
          ptyPaused.delete(ptyId);
        });
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

  // Preserve the user's scroll position if they've scrolled up. xterm.js
  // auto-scrolls to the bottom on every write(); capture the viewport before
  // the write so we can roll it back in the callback.
  const savedViewportY = surface.terminal.buffer.active.viewportY;
  const maxScrollBefore = Math.max(
    0,
    surface.terminal.buffer.active.length - surface.terminal.rows,
  );
  const wasScrolledUp = savedViewportY < maxScrollBefore;

  // Single write to xterm.js per frame — the callback fires when xterm.js has
  // processed this batch, which is our signal that it's ready for more.
  surface.terminal.write(merged, () => {
    if (wasScrolledUp) {
      const newViewportY = surface.terminal.buffer.active.viewportY;
      surface.terminal.scrollLines(savedViewportY - newViewportY);
    }
    // If more data arrived while we were rendering, flush again next frame
    const buffered = ptyBufferBytes.get(ptyId) || 0;
    if (buffered > 0) {
      scheduleFlush(ptyId);
    }
    // Resume PTY reader if we drained below low water mark
    if (ptyPaused.has(ptyId) && buffered < BUFFER_LOW_WATER) {
      invoke("resume_pty", { ptyId })
        .then(() => {
          ptyPaused.delete(ptyId);
        })
        .catch((err) => {
          console.error(
            "[terminal-service] resume_pty failed, terminal may hang:",
            err,
          );
          ptyPaused.delete(ptyId);
        });
    }
  });
}

// --- Event Listeners ---

/**
 * Show a desktop notification (Tauri plugin). Lazily requests permission on
 * first use; silently no-ops if denied. Failures are swallowed — a missing
 * notification daemon (Linux) shouldn't crash the terminal pipeline.
 */
async function sendDesktopNotification(
  title: string,
  body: string,
): Promise<void> {
  try {
    let permitted = await notifPermissionGranted();
    if (!permitted) {
      const result = await notifRequestPermission();
      permitted = result === "granted";
    }
    if (!permitted) return;
    notifSend({ title, body });
  } catch (err) {
    console.warn("[terminal-service] desktop notification failed:", err);
  }
}

// Module-level storage for active Tauri event unlisteners and the keydown handler
// reference. Populated by setupListeners(), drained by teardownListeners().
const _unlisteners: UnlistenFn[] = [];
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

export async function teardownListeners(): Promise<void> {
  for (const unlisten of _unlisteners) {
    unlisten();
  }
  _unlisteners.length = 0;
  if (_keydownHandler) {
    window.removeEventListener("keydown", _keydownHandler, { capture: true });
    _keydownHandler = null;
  }
}

function handlePtyExit(pty_id: number): void {
  // pty-exit arrives via emit while chunks arrive via Channel — different
  // transports, so a trailing chunk may already be in the per-pty buffer.
  // Flush it synchronously to the surface's terminal before we tear down
  // flow-control state and remove the surface from the workspace tree.
  const chunks = ptyBuffers.get(pty_id);
  const bytesBuffered = ptyBufferBytes.get(pty_id) || 0;
  if (chunks && chunks.length > 0 && bytesBuffered > 0) {
    const surface = findSurfaceByPty(pty_id);
    if (surface) {
      const merged = new Uint8Array(bytesBuffered);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      surface.terminal.write(merged);
    }
  }
  ptyBuffers.delete(pty_id);
  ptyBufferBytes.delete(pty_id);
  ptyFlushScheduled.delete(pty_id);
  ptyPaused.delete(pty_id);
  ptyHasOutput.delete(pty_id);
  firstOutputListeners.delete(pty_id);

  // Remove the surface from its pane, and collapse empty panes
  workspaces.update((wsList) => {
    for (const ws of wsList) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        const idx = pane.surfaces.findIndex(
          (s) => isTerminalSurface(s) && s.ptyId === pty_id,
        );
        if (idx >= 0) {
          pane.surfaces.splice(idx, 1);
          if (pane.surfaces.length > 0) {
            pane.activeSurfaceId =
              pane.surfaces[Math.min(idx, pane.surfaces.length - 1)]!.id;
          } else {
            // Pane is empty — collapse it from the split tree
            pane.activeSurfaceId = null;
            pane.resizeObserver?.disconnect();
            if (
              ws.splitRoot.type === "pane" &&
              ws.splitRoot.pane.id === pane.id
            ) {
              // This was the only pane in the workspace — remove the
              // workspace. Users are allowed to close all workspaces;
              // App.svelte renders an Empty Surface when the list is
              // empty, so we don't auto-create a default.
              const wsIdx = wsList.indexOf(ws);
              wsList.splice(wsIdx, 1);
              const currentIdx = get(activeWorkspaceIdx);
              if (currentIdx >= wsList.length) {
                activeWorkspaceIdx.set(wsList.length - 1);
              }
              return wsList;
            }
            // Find parent split and collapse it
            const parentInfo = findParentSplit(ws.splitRoot, pane.id);
            if (parentInfo && parentInfo.parent.type === "split") {
              const sibling =
                parentInfo.parent.children[parentInfo.index === 0 ? 1 : 0];
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
}

function handlePtyNotification(pty_id: number, text: string): void {
  // Filter out escape-sequence fragments that slipped through (e.g. "4;0;")
  if (/^\d+[;\d:\/]*$/.test(text) || !text.trim()) return;
  let notifyWorkspaceName: string | null = null;
  workspaces.update((wsList) => {
    const activeIdx = get(activeWorkspaceIdx);
    const activeWs = wsList[activeIdx];
    for (const ws of wsList) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s) && s.ptyId === pty_id) {
          s.notification = text;
          s.hasUnread = true;
          // Suppress desktop notification when the affected surface is
          // the foreground surface in the foreground pane — the user
          // is already looking at it.
          const inActiveWs = ws.id === activeWs?.id;
          const inActivePane = ws.activePaneId
            ? getAllPanes(ws.splitRoot).some(
                (p) =>
                  p.id === ws.activePaneId &&
                  p.surfaces.some((ps) => ps.id === s.id) &&
                  p.activeSurfaceId === s.id,
              )
            : false;
          if (!(inActiveWs && inActivePane)) {
            notifyWorkspaceName = ws.name;
          }
          return wsList;
        }
      }
    }
    return wsList;
  });
  if (notifyWorkspaceName) {
    void sendDesktopNotification(notifyWorkspaceName, text);
  }
}

function applyPtyTitle(pty_id: number, title: string) {
  let changed: { id: string; oldTitle: string; newTitle: string } | null = null;
  workspaces.update((wsList) => {
    for (const ws of wsList) {
      for (const s of getAllSurfaces(ws)) {
        if (isTerminalSurface(s) && s.ptyId === pty_id) {
          if (s.title !== title) {
            changed = { id: s.id, oldTitle: s.title, newTitle: title };
            s.title = title;
          }
          return wsList;
        }
      }
    }
    return wsList;
  });
  // Emit AFTER the store update so downstream listeners (passive agent
  // detection, status trackers) see the new title on the surface when
  // they look it up.
  if (changed) {
    const c = changed as { id: string; oldTitle: string; newTitle: string };
    eventBus.emit({
      type: "surface:titleChanged",
      id: c.id,
      oldTitle: c.oldTitle,
      newTitle: c.newTitle,
    });
  }
}

function handlePtyTitle(pty_id: number, title: string): void {
  // Filter out escape-sequence fragments that may slip through
  if (!title || /[\x00-\x1f\x7f]/.test(title) || /^\d+[;\d:\/]*$/.test(title))
    return;

  // Cancel any pending delayed title for this pty
  const existing = pendingRunningTitles.get(pty_id);
  if (existing) {
    clearTimeout(existing);
    pendingRunningTitles.delete(pty_id);
  }

  if (title.startsWith("Running: ")) {
    const timer = setTimeout(() => {
      pendingRunningTitles.delete(pty_id);
      applyPtyTitle(pty_id, title);
    }, 500);
    pendingRunningTitles.set(pty_id, timer);
  } else {
    applyPtyTitle(pty_id, title);
  }
}

export async function setupListeners() {
  // On Linux, prevent WebKitGTK from intercepting Ctrl+Shift+C/V before xterm.js
  if (!isMac) {
    _keydownHandler = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        (e.key === "C" || e.key === "c" || e.key === "V" || e.key === "v")
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", _keydownHandler, { capture: true });
  }
  _unlisteners.push(
    await listen<{ pty_id: number }>("pty-exit", (event) => {
      handlePtyExit(event.payload.pty_id);
    }),
  );

  _unlisteners.push(
    await listen<{ pty_id: number; text: string }>(
      "pty-notification",
      (event) => {
        handlePtyNotification(event.payload.pty_id, event.payload.text);
      },
    ),
  );

  // OSC 0/2: shell sets window title (shows process name or custom title)
  _unlisteners.push(
    await listen<{ pty_id: number; title: string }>("pty-title", (event) => {
      handlePtyTitle(event.payload.pty_id, event.payload.title);
    }),
  );
}

// --- Running Title Delay ---
// "Running: cmd" titles are delayed 500ms so quick commands don't flicker.
// Cancelled if precmd fires (via OSC 7) before the timer expires.
const pendingRunningTitles = new Map<number, ReturnType<typeof setTimeout>>();

// --- CWD Polling Fallback ---
// For shells that don't emit OSC 7, poll get_pty_cwd periodically.
// Uses get_all_pty_cwds to batch all PTYs into a single IPC round-trip,
// then applies a single workspaces.update() only when at least one cwd changed.
let cwdPollTimer: ReturnType<typeof setInterval> | null = null;
let cwdChangeHook: (() => void) | null = null;

export function registerCwdChangeHook(cb: () => void): void {
  cwdChangeHook = cb;
}

export function _stopCwdPolling(): void {
  if (cwdPollTimer) {
    clearInterval(cwdPollTimer);
    cwdPollTimer = null;
  }
  cwdChangeHook = null;
}

export function startCwdPolling() {
  if (cwdPollTimer) return;
  cwdPollTimer = setInterval(() => {
    invoke<Record<string, string>>("get_all_pty_cwds")
      .then((cwdMap) => {
        const wsList = get(workspaces);
        let anyChanged = false;
        for (const ws of wsList) {
          for (const s of getAllSurfaces(ws)) {
            if (!isTerminalSurface(s) || s.ptyId < 0) continue;
            const cwd = cwdMap[String(s.ptyId)];
            if (cwd && cwd !== s.cwd) {
              s.cwd = cwd;
              const basename = cwd.split("/").pop() || cwd;
              if (!s.title || s.title.startsWith("Shell ")) {
                s.title = basename || "~";
              }
              anyChanged = true;
            }
          }
        }
        // Notify subscribers once per tick only if something actually changed.
        // Returning the same array reference (l) is sufficient — Svelte calls
        // all subscribers on any .update() invocation regardless.
        if (anyChanged) {
          workspaces.update((l) => l);
          cwdChangeHook?.();
        }
      })
      .catch(() => {});
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
  workspaces.update((list) => [...list, ws]);
  activeWorkspaceIdx.set(0);
}

// --- Surface Creation helpers ---

const _urlRegex = /https?:\/\/[^\s"'<>()[\]{}]+/g;

/** Link provider for plain https?:// URLs — opens them via the Tauri shell. */
function createUrlLinkProvider(terminal: Terminal) {
  return {
    provideLinks(
      lineNumber: number,
      callback: (links: ILink[] | undefined) => void,
    ) {
      const line = terminal.buffer.active.getLine(lineNumber);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: ILink[] = [];
      _urlRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = _urlRegex.exec(text)) !== null) {
        const url = m[0]!;
        const startX = m.index + 1;
        const endX = m.index + url.length;
        links.push({
          range: {
            start: { x: startX, y: lineNumber },
            end: { x: endX, y: lineNumber },
          },
          text: url,
          decorations: { pointerCursor: true, underline: true },
          activate(_event: MouseEvent, text: string) {
            invoke("open_url", { url: text }).catch((err) =>
              console.warn("[terminal-service] open_url failed:", err),
            );
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

/**
 * Link provider for registered file-extension paths (e.g. `.ts`, `.md`).
 * On click, dispatches to whichever context-menu handler is registered for
 * the file's extension. Resolved relative to `surface.cwd`.
 */
function createFilePathLinkProvider(
  surface: TerminalSurface,
  terminal: Terminal,
) {
  return {
    provideLinks: (
      lineNumber: number,
      callback: (links: ILink[] | undefined) => void,
    ) => {
      const line = terminal.buffer.active.getLine(lineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString();
      const registered = getRegisteredFileExtensions();
      if (registered.length === 0) {
        callback([]);
        return;
      }
      const exts = registered.join("|");
      const patterns = [
        `"([^"]+\\.(?:${exts}))"`,
        `'([^']+\\.(?:${exts}))'`,
        `((?:/|\\./|~/)\\S[\\S ]*\\.(?:${exts}))(?=\\s|$)`,
        `(\\S+\\.(?:${exts}))(?=\\s|$)`,
      ];
      // eslint-disable-next-line security/detect-non-literal-regexp -- patterns are constant, only the allowed-extension list is interpolated
      const regex = new RegExp(patterns.join("|"), "gi");
      const candidates: { path: string; startX: number; endX: number }[] = [];
      let m;
      while ((m = regex.exec(text)) !== null) {
        const path = m[1] || m[2] || m[3] || m[4];
        if (!path) continue;
        const startX = m.index + m[0].indexOf(path);
        candidates.push({ path, startX, endX: startX + path.length });
      }
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }
      void Promise.all(
        candidates.map(async (c) => {
          const fullPath = await resolveFilePath(c.path, surface.cwd);
          const exists = await invoke<boolean>("file_exists", {
            path: fullPath,
          });
          if (!exists) return null;
          return {
            range: {
              start: { x: c.startX + 1, y: lineNumber },
              end: { x: c.endX + 1, y: lineNumber },
            },
            text: c.path,
            activate: async (e: MouseEvent, linkText: string) => {
              if (e.button !== 0) return;
              const resolved = await resolveFilePath(linkText, surface.cwd);
              const items = getContextMenuItemsForFile(resolved);
              await items[0]?.handler(resolved);
            },
          };
        }),
      )
        .then((results) => {
          const links = results.filter(
            (r): r is NonNullable<typeof r> => r !== null,
          );
          callback(links.length > 0 ? links : undefined);
        })
        .catch(() => {
          callback(undefined);
        });
    },
  };
}

/**
 * Build the xterm.js custom key event handler for `surface`. Returns a
 * function that intercepts Cmd/Ctrl shortcuts and returns `false` for keys
 * that should be handled by App.svelte rather than forwarded to the PTY.
 */
function createKeyHandler(
  surface: TerminalSurface,
  terminal: Terminal,
): (e: KeyboardEvent) => boolean {
  return (e: KeyboardEvent) => {
    if (e.type !== "keydown") return true;
    if (e.ctrlKey && !e.metaKey && e.key === "Tab") return false;
    if (
      e.ctrlKey &&
      e.shiftKey &&
      !e.metaKey &&
      (e.key === "C" || e.key === "c")
    ) {
      const sel = terminal.getSelection();
      if (sel) void clipboardWrite(sel);
      return false;
    }
    if (
      e.ctrlKey &&
      e.shiftKey &&
      !e.metaKey &&
      (e.key === "V" || e.key === "v")
    ) {
      e.preventDefault();
      void clipboardRead()
        .then((text) => {
          if (text && surface.ptyId >= 0) terminal.paste(text);
        })
        .catch((err) => console.warn("Clipboard read failed:", err));
      return false;
    }
    if (isMac) {
      if (
        e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "v"
      ) {
        e.preventDefault();
        if (surface.ptyId >= 0)
          void invoke("write_pty", { ptyId: surface.ptyId, data: "\x16" });
        return false;
      }
      if (!e.metaKey) return true;
      const k = e.key.toLowerCase();
      const shift = e.shiftKey;
      const alt = e.altKey;
      if (!alt && !shift && k === "c") {
        const sel = terminal.getSelection();
        if (sel) void clipboardWrite(sel);
        return false;
      }
      if (!alt && !shift && k === "v") {
        e.preventDefault();
        void clipboardRead()
          .then((text) => {
            if (text && surface.ptyId >= 0) terminal.paste(text);
          })
          .catch((err) => console.warn("Clipboard read failed:", err));
        return false;
      }
      if (!alt && !shift) {
        if (["n", "t", "d", "w", "b", "p", "k", "f", "g", "r"].includes(k))
          return false;
        if (k === "0" || (k >= "1" && k <= "9")) return false;
        if (k === "=" || k === "+" || k === "-") return false;
      }
      if (shift && !alt) {
        if (["d", "w", "h", "r", "p", "g", "t"].includes(k)) return false;
        if (k === "enter") return false;
        if (k === "[" || k === "]") return false;
      }
      if (
        alt &&
        ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k)
      )
        return false;
    } else {
      if (!e.ctrlKey || !e.shiftKey) return true;
      const k = e.key.toLowerCase();
      const alt = e.altKey;
      if (!alt) {
        if (
          [
            "n",
            "t",
            "d",
            "e",
            "w",
            "q",
            "b",
            "p",
            "k",
            "f",
            "g",
            "h",
            "r",
          ].includes(k)
        )
          return false;
        if (k === "0") return false;
        if (k === "enter") return false;
        if (k === "[" || k === "]") return false;
        if (k === "=" || k === "+" || k === "-" || k === "_") return false;
      }
    }
    return true;
  };
}

/**
 * Build the OSC 7 handler for `surface`. OSC 7 carries the current working
 * directory as "file://hostname/path"; we strip the scheme and update both
 * `surface.cwd` and the tab title.
 */
function createOsc7Handler(
  surface: TerminalSurface,
): (data: string) => boolean {
  return (data: string) => {
    let cwd = data;
    if (cwd.startsWith("file://")) {
      const rest = cwd.slice(7);
      const slashIdx = rest.indexOf("/");
      if (slashIdx >= 0) cwd = rest.slice(slashIdx);
    }
    if (cwd === surface.cwd) return true;
    surface.cwd = cwd;
    const basename = cwd.split("/").pop() || cwd;
    const pending = pendingRunningTitles.get(surface.ptyId);
    if (pending) {
      clearTimeout(pending);
      pendingRunningTitles.delete(surface.ptyId);
    }
    if (
      !surface.title ||
      surface.title.startsWith("Shell ") ||
      surface.title.startsWith("Running: ") ||
      !surface.title.includes(" ")
    ) {
      surface.title = basename || "~";
    }
    workspaces.update((l) => [...l]);
    cwdChangeHook?.();
    return true;
  };
}

/**
 * Build and display the right-click context menu for a terminal surface.
 * Includes Copy (when text is selected), Paste, optional path actions, and
 * terminal control items (Clear, Split Right, Split Down).
 */
function buildTerminalContextMenu(
  e: MouseEvent,
  surface: TerminalSurface,
  terminal: Terminal,
): void {
  e.preventDefault();
  const selection = terminal.getSelection();
  const items: MenuItem[] = [];
  if (selection) {
    items.push({
      label: "Copy",
      shortcut: isMac ? "⌘C" : "Ctrl+Shift+C",
      action: () => clipboardWrite(selection),
    });
  }
  items.push({
    label: "Paste",
    shortcut: isMac ? "⌘V" : "Ctrl+Shift+V",
    action: () =>
      void clipboardRead().then((t) => {
        if (t && surface.ptyId >= 0) terminal.paste(t);
      }),
  });
  const pathText = (selection || "").trim();
  const looksLikePath =
    pathText &&
    (pathText.startsWith("/") ||
      pathText.startsWith("./") ||
      pathText.startsWith("~/") ||
      pathText.match(/^[\w.-]+\.[a-z]+$/i));
  if (looksLikePath) {
    const resolvePath = () => resolveFilePath(pathText, surface.cwd);
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: "Copy Path",
      action: async () => clipboardWrite(await resolvePath()),
    });
    items.push({
      label: "Show in File Manager",
      action: async () =>
        invoke("show_in_file_manager", { path: await resolvePath() }),
    });
    items.push({
      label: "Open with Default App",
      action: async () =>
        invoke("open_with_default_app", { path: await resolvePath() }),
    });
  }
  items.push({ label: "", action: () => {}, separator: true });
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
}

// --- Surface Creation ---

export async function createTerminalSurface(
  pane: Pane,
  cwd?: string,
  env?: Record<string, string>,
): Promise<TerminalSurface> {
  const ptyId = -1; // PTY spawned later via connectPty() after fit()

  const currentXtermTheme = get(xtermTheme);
  const config = getConfig();

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: getConfig().fontSize ?? 14,
    fontFamily: resolvedFontFamily,
    theme: currentXtermTheme,
    allowProposedApi: true,
    scrollback: config.scrollback ?? 10000,
    smoothScrollDuration: 0,
    fastScrollModifier: "alt",
    vtExtensions: {
      kittyKeyboard: true,
    },
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);

  terminal.registerLinkProvider(createUrlLinkProvider(terminal));

  const termElement = document.createElement("div");
  termElement.style.cssText =
    "flex: 1; min-height: 0; min-width: 0; padding: 2px 4px;";

  const surface: TerminalSurface = {
    kind: "terminal",
    id: uid(),
    terminal,
    fitAddon,
    searchAddon,
    termElement,
    ptyId,
    title: `Shell ${pane.surfaces.length + 1}`,
    cwd: cwd,
    env: env,
    hasUnread: false,
    opened: false,
  };

  // Cmd+click file path detection — dispatches to context-menu handlers
  // registered for the file's extension. No preview-specific code here.
  terminal.registerLinkProvider(createFilePathLinkProvider(surface, terminal));

  // Key handler — intercept Cmd/Ctrl shortcuts, pass everything else to PTY
  terminal.attachCustomKeyEventHandler(createKeyHandler(surface, terminal));

  terminal.onData((data) => {
    if (surface.ptyId >= 0)
      void invoke("write_pty", { ptyId: surface.ptyId, data });
  });
  terminal.onResize(({ cols, rows }) => {
    if (surface.ptyId >= 0)
      void invoke("resize_pty", { ptyId: surface.ptyId, cols, rows });
  });
  terminal.onSelectionChange(() => {
    if (terminal.hasSelection()) {
      const text = terminal.getSelection();
      if (text) void clipboardWrite(text);
    }
  });
  // NOTE: We intentionally do NOT use terminal.onTitleChange() here.
  // xterm.js fires it with raw/partial escape sequence fragments (OSC 7 cwd data,
  // bracketed paste mode, etc.) concatenated into the title string. Instead, the
  // Rust backend parses OSC 0/2 cleanly and emits "pty-title" events (handled in
  // setupListeners), and OSC 7 cwd is handled by the registerOscHandler below.

  // OSC 7: shell reports cwd (parsed by xterm.js directly)
  terminal.parser.registerOscHandler(7, createOsc7Handler(surface));

  // Context menu on right-click
  termElement.addEventListener("contextmenu", (e) =>
    buildTerminalContextMenu(e, surface, terminal),
  );

  pane.surfaces.push(surface);
  pane.activeSurfaceId = surface.id;

  return surface;
}

/**
 * Approve a pending restored command for a surface — write it to the PTY and
 * clear the pending flag so the dialog/banner stop showing it. No-op if the
 * surface has nothing pending or the PTY isn't ready yet.
 */
export async function runDefinedCommand(
  surface: TerminalSurface,
): Promise<void> {
  if (!surface.definedCommand) return;
  if (!surface.pendingRestoreCommand) return;
  if (surface.ptyId < 0) return;
  try {
    await invoke("write_pty", {
      ptyId: surface.ptyId,
      data: `${surface.definedCommand}\n`,
    });
  } catch (err) {
    console.warn("[terminal-service] runDefinedCommand failed:", err);
    return;
  }
  surface.pendingRestoreCommand = false;
  workspaces.update((l) => [...l]);
}

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 14;

/**
 * Increase or decrease the terminal font size for all currently-mounted
 * terminal surfaces. Persists the new size to config so it survives restarts.
 * Also calls fitAddon.fit() on each terminal to recompute cols/rows for the
 * new character cell size.
 */
export function adjustFontSize(delta: number): void {
  const current = getConfig().fontSize ?? FONT_SIZE_DEFAULT;
  const next = Math.max(
    FONT_SIZE_MIN,
    Math.min(FONT_SIZE_MAX, current + delta),
  );
  if (next === current) return;
  void saveConfig({ fontSize: next });
  const wsList = get(workspaces);
  for (const ws of wsList) {
    for (const s of getAllSurfaces(ws)) {
      if (isTerminalSurface(s)) {
        s.terminal.options.fontSize = next;
        try {
          s.fitAddon.fit();
        } catch {
          // May fail if terminal is not attached to DOM yet — safe to ignore
        }
      }
    }
  }
}

export function resetFontSize(): void {
  const current = getConfig().fontSize ?? FONT_SIZE_DEFAULT;
  adjustFontSize(FONT_SIZE_DEFAULT - current);
}

/**
 * Drop the pending-restore flag without running anything. Keeps definedCommand
 * intact so future sessions still know what this pane was for.
 */
export function dismissDefinedCommand(surface: TerminalSurface): void {
  if (!surface.pendingRestoreCommand) return;
  surface.pendingRestoreCommand = false;
  workspaces.update((l) => [...l]);
}

/** Find the workspace + pane currently containing a given surface. Used to
 *  inject `GNAR_TERM_PANE_ID` / `GNAR_TERM_WORKSPACE_ID` into the PTY's env so
 *  any MCP-aware agent run inside the pane (claude, codex, etc.) can advertise
 *  its host context to the gnar-term GUI via the `$/gnar-term/hello` handshake.
 *
 *  Returns null if the surface isn't yet attached (rare race during creation). */
function findContextForSurface(
  surfaceId: string,
): { paneId: string; workspaceId: string } | null {
  for (const ws of get(workspaces)) {
    for (const pane of getAllPanes(ws.splitRoot)) {
      if (pane.surfaces.some((s) => s.id === surfaceId)) {
        return { paneId: pane.id, workspaceId: ws.id };
      }
    }
  }
  return null;
}

/** Spawn the PTY for a surface. Called after terminal.open() + fit() so the PTY
 *  gets the real terminal dimensions instead of hardcoded 80x24.
 *  Uses surface.cwd as the working directory. The optional cwd parameter is
 *  accepted for backwards compatibility but surface.cwd takes priority.
 *
 *  Injects `GNAR_TERM_PANE_ID` and `GNAR_TERM_WORKSPACE_ID` into the PTY env
 *  when the surface is already attached to a workspace pane. This is the
 *  delivery mechanism for the MCP connection-binding contract — see the
 *  Spacebase MCP spec § Connection binding. */
export async function connectPty(
  surface: TerminalSurface,
  cwd?: string,
  env?: Record<string, string>,
): Promise<void> {
  if (surface.ptyId >= 0) return; // already connected
  const cols = surface.terminal.cols;
  const rows = surface.terminal.rows;
  const effectiveCwd = surface.cwd || cwd || null;

  // Per-pty Channel carries raw output bytes from the Rust reader thread to
  // xterm.js. Holds a pending ptyId in a closure so chunks delivered before
  // spawn_pty resolves are still routable once the id is known.
  let resolvedPtyId = -1;
  const pending: Uint8Array[] = [];
  const onOutput = new Channel<ArrayBuffer>();
  onOutput.onmessage = (buf) => {
    const bytes = new Uint8Array(buf);
    if (resolvedPtyId < 0) {
      pending.push(bytes);
      return;
    }
    handlePtyChunk(resolvedPtyId, bytes);
  };

  const ctx = findContextForSurface(surface.id);
  const extraEnv: Record<string, string> = { ...(env ?? {}) };
  if (ctx) {
    extraEnv.GNAR_TERM_PANE_ID = ctx.paneId;
    extraEnv.GNAR_TERM_WORKSPACE_ID = ctx.workspaceId;
  }

  const shellConfig = getConfig().shell || undefined;
  const deferred = ptyReady.get(surface.id);
  try {
    const ptyId = await invoke<number>("spawn_pty", {
      cols,
      rows,
      cwd: effectiveCwd,
      onOutput,
      extraEnv,
      shell: shellConfig ?? null,
    });
    surface.ptyId = ptyId;
    registerPtyForSurface(ptyId, surface);
    resolvedPtyId = ptyId;
    // Broadcast once the real ptyId is known so services like passive
    // agent detection can wire an output observer against it — the
    // earlier surface:created event carries the placeholder ptyId of -1.
    eventBus.emit({ type: "surface:ptyReady", id: surface.id, ptyId });
    for (const bytes of pending) handlePtyChunk(ptyId, bytes);
    pending.length = 0;
    deferred?.resolve(ptyId);
    ptyReady.delete(surface.id);
  } catch (err) {
    console.error("Failed to spawn PTY:", err);
    surface.ptyId = -1;
    surface.spawnError = err instanceof Error ? err.message : String(err);
    deferred?.reject(err instanceof Error ? err : new Error(String(err)));
    ptyReady.delete(surface.id);
  }
}
