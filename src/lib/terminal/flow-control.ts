/**
 * PTY flow control.
 *
 * Buffers raw PTY output per-pty and flushes it to xterm.js on an rAF cadence,
 * pausing the Rust reader thread when the buffer crosses the high-water mark and
 * resuming once it drains below the low-water mark. Also tees each chunk to the
 * MCP output buffer.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import { workspaces } from "../stores/workspace";
import { findSurfaceByPtyId } from "../types";
import type { TerminalSurface } from "../types";
import { appendMcpOutput } from "../services/mcp-output-buffer";

const ptyBuffers = new Map<number, Uint8Array[]>();
const ptyBufferBytes = new Map<number, number>();
const ptyFlushScheduled = new Set<number>();
const ptyPaused = new Set<number>();

const BUFFER_HIGH_WATER = 128 * 1024; // 128KB
const BUFFER_LOW_WATER = 32 * 1024;   // 32KB

function findSurfaceByPty(ptyId: number): TerminalSurface | null {
  return findSurfaceByPtyId(get(workspaces), ptyId);
}

function scheduleFlush(ptyId: number) {
  if (ptyFlushScheduled.has(ptyId)) return;
  ptyFlushScheduled.add(ptyId);
  requestAnimationFrame(() => flushPtyBuffer(ptyId));
}

/** Append a raw PTY chunk to the per-pty buffer, tee it to the MCP buffer
 *  if one is registered, and schedule an rAF flush to xterm.js. Exported for
 *  tests; in production this is called from the Channel onmessage handler
 *  created in connectPty(). */
export function handlePtyChunk(ptyId: number, bytes: Uint8Array): void {
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
  scheduleFlush(ptyId);
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

  // Single write to xterm.js per frame — the callback fires when xterm.js has
  // processed this batch, which is our signal that it's ready for more.
  surface.terminal.write(merged, () => {
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

/** On pty-exit, flush any trailing chunk that arrived via the Channel just
 *  before the exit event, then tear down all flow-control state for the pty.
 *
 *  pty-exit arrives via emit while chunks arrive via Channel — different
 *  transports, so a trailing chunk may already be in the per-pty buffer. Flush
 *  it synchronously to the surface's terminal before the caller removes the
 *  surface from the workspace tree. */
export function drainAndTeardownPty(ptyId: number): void {
  const chunks = ptyBuffers.get(ptyId);
  const bytesBuffered = ptyBufferBytes.get(ptyId) || 0;
  if (chunks && chunks.length > 0 && bytesBuffered > 0) {
    const surface = findSurfaceByPty(ptyId);
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
  ptyBuffers.delete(ptyId);
  ptyBufferBytes.delete(ptyId);
  ptyFlushScheduled.delete(ptyId);
  ptyPaused.delete(ptyId);
}
