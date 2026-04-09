/**
 * Tests for CWD enforcement when creating terminals in worktree workspaces.
 *
 * Verifies that:
 * - connectPty passes env map including GNARTERM_WORKTREE_ROOT when provided
 * - connectPty passes cwd from worktreePath
 * - connectPty passes null env when no worktree env is provided
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("CWD enforcement for worktree workspaces", () => {
  it("passes env with GNARTERM_WORKTREE_ROOT to spawn_pty", async () => {
    const spawnCalls: {
      cols: number;
      rows: number;
      cwd: string | null;
      env: Record<string, string> | null;
    }[] = [];

    mockIPC((cmd, args) => {
      if (cmd === "spawn_pty") {
        spawnCalls.push({
          cols: (args as any).cols,
          rows: (args as any).rows,
          cwd: (args as any).cwd,
          env: (args as any).env,
        });
        return 42; // ptyId
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 100, rows: 30 },
    } as any;

    await connectPty(surface, "/projects/worktree/feature-branch", {
      GNARTERM_WORKTREE_ROOT: "/projects/worktree/feature-branch",
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/projects/worktree/feature-branch");
    expect(spawnCalls[0].env).toEqual({
      GNARTERM_WORKTREE_ROOT: "/projects/worktree/feature-branch",
    });
    expect(surface.ptyId).toBe(42);
  });

  it("passes null env when no env parameter provided", async () => {
    const spawnCalls: { env: Record<string, string> | null }[] = [];

    mockIPC((cmd, args) => {
      if (cmd === "spawn_pty") {
        spawnCalls.push({
          env: (args as any).env,
        });
        return 1;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as any;

    await connectPty(surface, "/tmp");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].env).toBeNull();
  });

  it("passes cwd from worktree path", async () => {
    const spawnCalls: { cwd: string | null }[] = [];

    mockIPC((cmd, args) => {
      if (cmd === "spawn_pty") {
        spawnCalls.push({ cwd: (args as any).cwd });
        return 1;
      }
      return undefined;
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as any;

    await connectPty(surface, "/my/worktree/path");

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe("/my/worktree/path");
  });
});
