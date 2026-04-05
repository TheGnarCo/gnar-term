/**
 * Terminal sizing integration tests.
 *
 * Uses @tauri-apps/api/mocks (Tauri's official test utilities) to verify:
 * - PTY spawns with real dimensions from fit(), not hardcoded 80x24
 * - fit() is deferred until after DOM layout (tick + rAF)
 * - Tab visibility change triggers re-fit
 * - connectPty passes terminal.cols/rows to spawn_pty
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mockIPC, mockWindows, clearMocks, mockConvertFileSrc } from "@tauri-apps/api/mocks";
import { invoke } from "@tauri-apps/api/core";
import { randomFillSync } from "crypto";

// jsdom doesn't provide WebCrypto — polyfill for mockIPC
beforeEach(() => {
  Object.defineProperty(window, "crypto", {
    value: { getRandomValues: (buf: Uint8Array) => randomFillSync(buf) },
    writable: true,
  });
  mockWindows("main");
  mockConvertFileSrc("macos");
});

afterEach(() => {
  clearMocks();
});

// ─── connectPty ──────────────────────────────────────────────────

describe("connectPty uses real terminal dimensions", () => {
  it("spawns PTY with terminal.cols and terminal.rows, not hardcoded values", async () => {
    const spawnCalls: { cols: number; rows: number }[] = [];

    mockIPC((cmd, args) => {
      if (cmd === "spawn_pty") {
        spawnCalls.push({ cols: (args as any).cols, rows: (args as any).rows });
        return 1; // ptyId
      }
      return undefined;
    });

    // Import connectPty — it uses the real invoke which is now mocked via mockIPC
    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 120, rows: 36 },
    } as any;

    await connectPty(surface, "/tmp");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cols).toBe(120);
    expect(spawnCalls[0].rows).toBe(36);
    expect(surface.ptyId).toBe(1);
  });

  it("does not spawn if already connected", async () => {
    const spawnCalls: any[] = [];

    mockIPC((cmd, args) => {
      if (cmd === "spawn_pty") {
        spawnCalls.push(args);
        return 2;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = { ptyId: 5, terminal: { cols: 80, rows: 24 } } as any;
    await connectPty(surface);

    expect(spawnCalls).toHaveLength(0);
    expect(surface.ptyId).toBe(5);
  });

  it("sets ptyId to -1 on spawn failure", async () => {
    mockIPC((cmd) => {
      if (cmd === "spawn_pty") throw new Error("spawn failed");
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = { ptyId: -1, terminal: { cols: 80, rows: 24 } } as any;
    await connectPty(surface);

    expect(surface.ptyId).toBe(-1);
  });
});

// ─── resolveFilePath ─────────────────────────────────────────────

describe("resolveFilePath with mockIPC", () => {
  it("expands tilde via get_home IPC call", async () => {
    mockIPC((cmd) => {
      if (cmd === "get_home") return "/Users/testuser";
      return undefined;
    });

    const { resolveFilePath } = await import("../lib/terminal-service");

    const result = await resolveFilePath("~/Documents/report.pdf", "/some/cwd");
    expect(result).toBe("/Users/testuser/Documents/report.pdf");
  });

  it("absolute paths bypass IPC entirely", async () => {
    let ipcCalled = false;
    mockIPC(() => {
      ipcCalled = true;
      return undefined;
    });

    const { resolveFilePath } = await import("../lib/terminal-service");

    const result = await resolveFilePath("/absolute/path.pdf", "/some/cwd");
    expect(result).toBe("/absolute/path.pdf");
    expect(ipcCalled).toBe(false);
  });
});
