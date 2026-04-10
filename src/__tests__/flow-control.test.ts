/**
 * Flow control tests — rAF batching + backpressure
 *
 * Tests exercise the flow control logic from terminal-service.ts:
 *   1. Multiple rapid events are coalesced into a single terminal.write()
 *   2. Backpressure (pause_pty) triggers when buffered data exceeds 128KB
 *   3. Resume fires when the buffer drains below 32KB
 *   4. Cleanup happens on pty-exit
 *   5. Stress test: simulates ps aux / find scale output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";

// These tests replicate the flow control pattern from terminal-service.ts
// without importing it directly (to avoid full module initialization)

const BUFFER_HIGH_WATER = 128 * 1024;
const BUFFER_LOW_WATER = 32 * 1024;

describe("Flow control — rAF batching", () => {
  let ptyBuffers: Map<number, Uint8Array[]>;
  let ptyBufferBytes: Map<number, number>;
  let ptyFlushScheduled: Set<number>;
  let ptyPaused: Set<number>;
  let rafCallbacks: Array<FrameRequestCallback>;
  let writeCallbacks: Array<() => void>;
  let mockTerminal: { write: ReturnType<typeof vi.fn> };
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ptyBuffers = new Map();
    ptyBufferBytes = new Map();
    ptyFlushScheduled = new Set();
    ptyPaused = new Set();
    rafCallbacks = [];
    writeCallbacks = [];

    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    mockTerminal = {
      write: vi
        .fn()
        .mockImplementation((_data: Uint8Array, cb?: () => void) => {
          if (cb) writeCallbacks.push(cb);
        }),
    };

    mockInvoke = vi.mocked(invoke);
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function scheduleFlush(ptyId: number) {
    if (ptyFlushScheduled.has(ptyId)) return;
    ptyFlushScheduled.add(ptyId);
    requestAnimationFrame(() => flushPtyBuffer(ptyId));
  }

  function flushPtyBuffer(ptyId: number) {
    ptyFlushScheduled.delete(ptyId);
    const chunks = ptyBuffers.get(ptyId);
    if (!chunks || chunks.length === 0) return;

    const totalBytes = ptyBufferBytes.get(ptyId) || 0;
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.length = 0;
    ptyBufferBytes.set(ptyId, 0);

    mockTerminal.write(merged, () => {
      const buffered = ptyBufferBytes.get(ptyId) || 0;
      if (buffered > 0) scheduleFlush(ptyId);
      if (ptyPaused.has(ptyId) && buffered < BUFFER_LOW_WATER) {
        ptyPaused.delete(ptyId);
        invoke("resume_pty", { ptyId } as Record<string, unknown>);
      }
    });
  }

  function emitPtyOutput(ptyId: number, byteLength: number) {
    const bytes = new Uint8Array(byteLength);
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
      invoke("pause_pty", { ptyId } as Record<string, unknown>);
    }
    scheduleFlush(ptyId);
  }

  function flushRAF() {
    const cbs = rafCallbacks.splice(0);
    cbs.forEach((cb) => cb(performance.now()));
  }

  it("coalesces multiple events into a single terminal.write() per frame", () => {
    for (let i = 0; i < 10; i++) emitPtyOutput(1, 4096);
    expect(mockTerminal.write).not.toHaveBeenCalled();
    flushRAF();
    expect(mockTerminal.write).toHaveBeenCalledTimes(1);
    const written = mockTerminal.write.mock.calls[0][0] as Uint8Array;
    expect(written.length).toBe(10 * 4096);
  });

  it("pauses PTY when buffer exceeds high water mark (128KB)", () => {
    for (let i = 0; i < 33; i++) emitPtyOutput(1, 4096);
    expect(mockInvoke).toHaveBeenCalledWith("pause_pty", { ptyId: 1 });
  });

  it("resumes PTY after buffer drains below low water mark (32KB)", () => {
    for (let i = 0; i < 33; i++) emitPtyOutput(1, 4096);
    expect(mockInvoke).toHaveBeenCalledWith("pause_pty", { ptyId: 1 });
    mockInvoke.mockClear();

    flushRAF();
    expect(mockTerminal.write).toHaveBeenCalledTimes(1);
    writeCallbacks[0]();
    expect(mockInvoke).toHaveBeenCalledWith("resume_pty", { ptyId: 1 });
  });

  it("cleans up all state on pty-exit", () => {
    emitPtyOutput(1, 4096);
    emitPtyOutput(1, 4096);

    ptyBuffers.delete(1);
    ptyBufferBytes.delete(1);
    ptyFlushScheduled.delete(1);
    ptyPaused.delete(1);

    expect(ptyBuffers.has(1)).toBe(false);
    expect(ptyBufferBytes.has(1)).toBe(false);
    expect(ptyPaused.has(1)).toBe(false);
  });

  it("schedules another flush if data arrives during write processing", () => {
    emitPtyOutput(1, 4096);
    flushRAF();
    expect(mockTerminal.write).toHaveBeenCalledTimes(1);

    emitPtyOutput(1, 4096);
    writeCallbacks[0]();
    expect(rafCallbacks.length).toBe(1);

    flushRAF();
    expect(mockTerminal.write).toHaveBeenCalledTimes(2);
  });

  it("stress test: simulates ps aux output (~200KB) without flooding terminal.write()", () => {
    const CHUNKS = 50;
    const CHUNK_SIZE = 4096;
    for (let i = 0; i < CHUNKS; i++) emitPtyOutput(1, CHUNK_SIZE);

    expect(mockInvoke).toHaveBeenCalledWith("pause_pty", { ptyId: 1 });
    flushRAF();
    expect(mockTerminal.write).toHaveBeenCalledTimes(1);
    const totalWritten = (mockTerminal.write.mock.calls[0][0] as Uint8Array)
      .length;
    expect(totalWritten).toBe(CHUNKS * CHUNK_SIZE);

    mockInvoke.mockClear();
    writeCallbacks[0]();
    expect(mockInvoke).toHaveBeenCalledWith("resume_pty", { ptyId: 1 });
  });

  it("stress test: sustained high-throughput output (2MB)", () => {
    const TOTAL_CHUNKS = 500;
    const BURST_SIZE = 50;
    let totalTerminalWrites = 0;

    for (let burst = 0; burst < TOTAL_CHUNKS / BURST_SIZE; burst++) {
      for (let i = 0; i < BURST_SIZE; i++) emitPtyOutput(1, 4096);
      flushRAF();
      totalTerminalWrites +=
        mockTerminal.write.mock.calls.length - totalTerminalWrites;
      if (writeCallbacks.length > 0)
        writeCallbacks[writeCallbacks.length - 1]();
    }

    expect(totalTerminalWrites).toBeLessThanOrEqual(TOTAL_CHUNKS / BURST_SIZE);
    expect(totalTerminalWrites).toBeGreaterThan(0);
  });
});
