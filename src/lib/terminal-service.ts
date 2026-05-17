/**
 * Terminal Service — PTY lifecycle, flow control, and surface creation.
 *
 * Extracted from the old TerminalManager class for use with Svelte stores.
 * This module owns all non-DOM terminal logic: spawning PTYs, buffering output,
 * creating TerminalSurface objects.
 *
 * Post-cutover (cycle-21): xterm.js is removed. All terminal rendering is
 * handled by AlacrittyTerminalSurface (canvas-2d + alacritty engine). This
 * service manages PTY lifecycle only.
 */

import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { appendMcpOutput } from "./services/mcp-output-buffer";
import { eventBus } from "./services/event-bus";
import { notifyOutputObservers } from "./services/surface-output-observer";
import { getConfig, saveConfig } from "./config";
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
import { workspaces, activeWorkspaceIdx } from "./stores/workspace";
import type { TerminalSurface, Pane } from "./types";
import { uid, getAllSurfaces, getAllPanes, isTerminalSurface } from "./types";

/**
 * Platform detection — used for Cmd (macOS) vs Ctrl (Linux/Windows) shortcuts.
 *
 * `navigator.platform` is deprecated; modern browsers prefer
 * `navigator.userAgentData.platform` or the userAgent string. We
 * belt-and-suspenders both: the userAgent fallback covers WebKitGTK /
 * future engines that drop `platform`, and the `platform` check covers
 * older runtimes whose userAgent does not literally contain "Mac".
 */
export const isMac =
  typeof navigator !== "undefined" &&
  (navigator.userAgent.includes("Mac") ||
    navigator.platform.toUpperCase().includes("MAC"));

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
 *  if one is registered, and schedule an rAF flush. Exported for
 *  tests; in production this is called from the Channel onmessage handler
 *  created in connectPty(). With the alacritty engine the Rust backend
 *  processes PTY output directly; this function manages backpressure and MCP
 *  fan-out only. */
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

  // Concatenate all buffered chunks (for MCP buffer and observer fan-out).
  // With the Alacritty engine, PTY output is consumed by the Rust backend —
  // no write to an xterm.js Terminal object is needed here.
  const totalBytes = ptyBufferBytes.get(ptyId) || 0;
  chunks.length = 0;
  ptyBufferBytes.set(ptyId, 0);

  // Resume PTY reader if we drained below low water mark
  if (ptyPaused.has(ptyId) && totalBytes < BUFFER_LOW_WATER) {
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

function handlePtyExit(pty_id: number, exit_code: number | null = null): void {
  // pty-exit arrives via emit while chunks arrive via Channel — different
  // transports, so a trailing chunk may already be in the per-pty buffer.
  // With the Alacritty engine the Rust backend processes PTY output directly;
  // we just discard any buffered bytes on the TypeScript side.
  ptyBuffers.delete(pty_id);
  ptyBufferBytes.delete(pty_id);
  ptyFlushScheduled.delete(pty_id);
  ptyPaused.delete(pty_id);
  ptyHasOutput.delete(pty_id);
  firstOutputListeners.delete(pty_id);
  osc7ReceivedPtys.delete(pty_id);

  // Remove the surface from its pane, and collapse empty panes.
  // Emit `surface:closed` so listeners (tab bar reactivity,
  // agent-detection-service) react — without it the bot status lingers
  // and the tab strip stays stale on natural agent exit / kill_agent.
  let closedSurfaceId: string | null = null;
  let closedPaneId: string | null = null;
  workspaces.update((wsList) => {
    for (const ws of wsList) {
      for (const pane of getAllPanes(ws.paneLayout)) {
        const idx = pane.surfaces.findIndex(
          (s) => isTerminalSurface(s) && s.ptyId === pty_id,
        );
        if (idx >= 0) {
          const exiting = pane.surfaces[idx] as TerminalSurface;
          const { definedCommand, cwd } = exiting;
          closedSurfaceId = exiting.id;
          closedPaneId = pane.id;
          pane.surfaces.splice(idx, 1);
          if (pane.surfaces.length > 0) {
            pane.activeSurfaceId =
              pane.surfaces[Math.min(idx, pane.surfaces.length - 1)]!.id;
          } else {
            // Pane is empty — show relaunch prompt instead of collapsing
            pane.activeSurfaceId = null;
            pane.exitedSurface = {
              code: exit_code ?? 0,
              definedCommand,
              cwd,
            };
          }
          return [...wsList];
        }
      }
    }
    return wsList;
  });
  if (closedSurfaceId !== null && closedPaneId !== null) {
    eventBus.emit({
      type: "surface:closed",
      id: closedSurfaceId,
      paneId: closedPaneId,
    });
  }
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
            ? getAllPanes(ws.paneLayout).some(
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
          // A user-set rename wins over OSC 0/2 escape-sequence updates.
          // Without this guard, a long-running shell that re-emits its
          // title on every prompt (zsh / bash / starship) would clobber
          // the explicit name the user assigned.
          if (s.userDefinedTitle) return wsList;
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
  // On Linux, prevent WebKitGTK from intercepting Ctrl+Shift+C/V before the terminal canvas
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
    await listen<{ pty_id: number; exit_code?: number | null }>(
      "pty-exit",
      (event) => {
        handlePtyExit(event.payload.pty_id, event.payload.exit_code ?? null);
      },
    ),
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
//
// `osc7ReceivedPtys` records PTYs that have ever delivered an OSC 7
// sequence — once a shell proves it speaks OSC 7 we can skip it on every
// subsequent poll tick. The polling fallback only matters for shells
// that never emit OSC 7 at all. Cleaned up in `handlePtyExit` so the set
// can never grow unbounded across long-running sessions.
let cwdPollTimer: ReturnType<typeof setInterval> | null = null;
let cwdChangeHook: (() => void) | null = null;
const osc7ReceivedPtys = new Set<number>();

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
            // Skip PTYs that have already proven they emit OSC 7 — the
            // polling fallback only exists for shells that never deliver
            // a CWD escape sequence. Saves an IPC-derived diff loop per
            // tick on the common case.
            if (osc7ReceivedPtys.has(s.ptyId)) continue;
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

// --- Surface Creation ---

/**
 * Create a plain TerminalSurface for the alacritty engine.
 *
 * Post-cutover (cycle-21): no xterm.js Terminal object is created. The
 * surface is a lightweight record; rendering is owned by
 * AlacrittyTerminalSurface.svelte. The PTY is spawned lazily by
 * connectPty(), called from AlacrittyTerminalSurface on mount.
 */
export async function createTerminalSurface(
  pane: Pane,
  cwd?: string,
  env?: Record<string, string>,
): Promise<TerminalSurface> {
  const surface: TerminalSurface = {
    kind: "terminal",
    id: uid(),
    ptyId: -1,
    title: `Shell ${pane.surfaces.length + 1}`,
    cwd: cwd,
    env: env,
    hasUnread: false,
    opened: false,
  };

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
  workspaces.update((l) => l);
}

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 14;

/**
 * Increase or decrease the terminal font size. Persists the new size to
 * config; AlacrittyTerminalSurface's cell-metrics store picks up the change
 * automatically via the font-size store subscription.
 */
export function adjustFontSize(delta: number): void {
  const current = getConfig().fontSize ?? FONT_SIZE_DEFAULT;
  const next = Math.max(
    FONT_SIZE_MIN,
    Math.min(FONT_SIZE_MAX, current + delta),
  );
  if (next === current) return;
  void saveConfig({ fontSize: next });
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
  workspaces.update((l) => l);
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
    for (const pane of getAllPanes(ws.paneLayout)) {
      if (pane.surfaces.some((s) => s.id === surfaceId)) {
        return { paneId: pane.id, workspaceId: ws.id };
      }
    }
  }
  return null;
}

/** Spawn the PTY for a surface. With the alacritty engine, initial dimensions
 *  default to 80×24; AlacrittyTerminalSurface calls resize_alacritty_engine
 *  on mount with the actual canvas dimensions, which reflows the engine and
 *  emits a fresh Snapshot.
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
  // Default 80×24: AlacrittyTerminalSurface resizes on mount via the canvas
  // ResizeObserver, so the initial dimensions are immediately corrected.
  const cols = 80;
  const rows = 24;
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
