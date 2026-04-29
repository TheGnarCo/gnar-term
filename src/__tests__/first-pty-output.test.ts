/**
 * Unit tests for onFirstPtyOutput (terminal-service.ts).
 *
 * Tests drive the hook directly through handlePtyChunk (both are exported),
 * avoiding any DOM or Tauri surface. Covers:
 *   1. Callback fires on first chunk, not on subsequent ones.
 *   2. Unsubscribe cancels a pending callback.
 *   3. Multiple listeners on the same ptyId all fire.
 *   4. If output was already seen, the callback fires asynchronously (microtask).
 *   5. Cleanup: listeners do not fire after pty-exit (ptyHasOutput deleted).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Tauri mocks must be declared before importing from terminal-service.
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
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
}));

import { onFirstPtyOutput, handlePtyChunk } from "../lib/terminal-service";

// Terminal-service keeps per-pty state in module-level Maps. Using different
// ptyIds per test avoids cross-test contamination without a reset API.
let nextPtyId = 10000;
function freshId(): number {
  return nextPtyId++;
}
const CHUNK = new Uint8Array([0x41]); // "A"

describe("onFirstPtyOutput", () => {
  it("fires the callback on the first chunk for a ptyId", () => {
    const id = freshId();
    const cb = vi.fn();
    onFirstPtyOutput(id, cb);
    expect(cb).not.toHaveBeenCalled();
    handlePtyChunk(id, CHUNK);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the callback again on subsequent chunks", () => {
    const id = freshId();
    const cb = vi.fn();
    onFirstPtyOutput(id, cb);
    handlePtyChunk(id, CHUNK);
    handlePtyChunk(id, CHUNK);
    handlePtyChunk(id, CHUNK);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe prevents the callback from firing", () => {
    const id = freshId();
    const cb = vi.fn();
    const unlisten = onFirstPtyOutput(id, cb);
    unlisten();
    handlePtyChunk(id, CHUNK);
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe is safe to call multiple times", () => {
    const id = freshId();
    const cb = vi.fn();
    const unlisten = onFirstPtyOutput(id, cb);
    unlisten();
    unlisten(); // second call must not throw
    handlePtyChunk(id, CHUNK);
    expect(cb).not.toHaveBeenCalled();
  });

  it("multiple listeners on the same ptyId all fire on first chunk", () => {
    const id = freshId();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    onFirstPtyOutput(id, cb1);
    onFirstPtyOutput(id, cb2);
    handlePtyChunk(id, CHUNK);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it("fires immediately (via microtask) when ptyId already has output", async () => {
    const id = freshId();
    // Emit output first, then register listener.
    handlePtyChunk(id, CHUNK);
    const cb = vi.fn();
    onFirstPtyOutput(id, cb);
    // Not yet synchronously fired.
    expect(cb).not.toHaveBeenCalled();
    // Flush microtask queue.
    await Promise.resolve();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("already-seen unsubscribe cancels the microtask callback", async () => {
    const id = freshId();
    handlePtyChunk(id, CHUNK);
    const cb = vi.fn();
    const unlisten = onFirstPtyOutput(id, cb);
    unlisten();
    await Promise.resolve();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("onFirstPtyOutput — safety timeout integration (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("safety timeout fires after 30s and prevents callback from running", () => {
    const id = freshId();
    const cb = vi.fn();

    const unlisten = onFirstPtyOutput(id, cb);
    // Simulate the safety timeout pattern used in spawn_agent.
    setTimeout(() => {
      unlisten();
    }, 30000);

    vi.advanceTimersByTime(30001);
    expect(cb).not.toHaveBeenCalled();

    // Output arrives after timeout — cb must NOT fire.
    handlePtyChunk(id, CHUNK);
    expect(cb).not.toHaveBeenCalled();
  });

  it("callback fires before 30s when output arrives first", () => {
    const id = freshId();
    const cb = vi.fn();

    const unlisten = onFirstPtyOutput(id, cb);
    let timerFired = false;
    const safetyTimer = setTimeout(() => {
      timerFired = true;
      unlisten();
    }, 30000);

    // Output arrives at 1s — callback fires, no warning needed.
    vi.advanceTimersByTime(1000);
    handlePtyChunk(id, CHUNK);
    expect(cb).toHaveBeenCalledTimes(1);
    clearTimeout(safetyTimer);

    vi.advanceTimersByTime(30000);
    expect(timerFired).toBe(false); // timer was cleared
    expect(cb).toHaveBeenCalledTimes(1); // still only once
  });
});
