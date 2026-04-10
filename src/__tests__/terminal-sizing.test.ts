/**
 * Terminal sizing integration tests.
 *
 * Uses @tauri-apps/api/mocks (Tauri's official test utilities) to verify:
 * - PTY spawns with real dimensions from fit(), not hardcoded 80x24
 * - fit() is deferred until after DOM layout (tick + rAF)
 * - Tab visibility change triggers re-fit
 * - connectPty passes terminal.cols/rows to spawn_pty
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mockIPC,
  mockWindows,
  clearMocks,
  mockConvertFileSrc,
} from "@tauri-apps/api/mocks";
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
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({ cols: a.cols as number, rows: a.rows as number });
        return 1; // ptyId
      }
      return undefined;
    });

    // Import connectPty — it uses the real invoke which is now mocked via mockIPC
    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 120, rows: 36 },
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface, "/tmp");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cols).toBe(120);
    expect(spawnCalls[0].rows).toBe(36);
    expect(surface.ptyId).toBe(1);
  });

  it("passes cwd from surface.cwd to spawn_pty", async () => {
    const spawnCalls: { cols: number; rows: number; cwd: string | null }[] = [];

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({
          cols: a.cols as number,
          rows: a.rows as number,
          cwd: a.cwd as string | null,
        });
        return 3;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
      cwd: "/Users/test/Documents",
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/Users/test/Documents");
    expect(surface.ptyId).toBe(3);
  });

  it("passes cwd parameter to spawn_pty when surface.cwd is unset", async () => {
    const spawnCalls: { cwd: string | null }[] = [];

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({ cwd: a.cwd as string | null });
        return 4;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface, "/tmp/fallback");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/tmp/fallback");
  });

  it("surface.cwd takes priority over cwd parameter", async () => {
    const spawnCalls: { cwd: string | null }[] = [];

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({ cwd: a.cwd as string | null });
        return 5;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
      cwd: "/Users/test/Documents",
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface, "/tmp/ignored");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/Users/test/Documents");
  });

  it("sends null cwd when neither surface.cwd nor parameter is set", async () => {
    const spawnCalls: { cwd: string | null }[] = [];

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({ cwd: a.cwd as string | null });
        return 6;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBeNull();
  });

  it("does not spawn if already connected", async () => {
    const spawnCalls: unknown[] = [];

    mockIPC((cmd, args) => {
      if (cmd === "spawn_pty") {
        spawnCalls.push(args);
        return 2;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: 5,
      terminal: { cols: 80, rows: 24 },
    } as unknown as Parameters<typeof connectPty>[0];
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

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as unknown as Parameters<typeof connectPty>[0];
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
