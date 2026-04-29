/**
 * Regression tests for three config-driven terminal features:
 *  1. Configurable scrollback buffer — createTerminalSurface uses config.scrollback
 *  2. Global default shell path — connectPty passes config.shell to spawn_pty
 *  3. Copy-on-select — onSelectionChange wires up clipboard write
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mockIPC,
  mockWindows,
  clearMocks,
  mockConvertFileSrc,
} from "@tauri-apps/api/mocks";
import { randomFillSync } from "crypto";

// ─── WebCrypto polyfill for mockIPC ──────────────────────────────────────────
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
  vi.resetModules();
  vi.restoreAllMocks();
});

// ─── Change 1: Scrollback buffer ─────────────────────────────────────────────

describe("createTerminalSurface scrollback from config", () => {
  it("uses config.scrollback when set", async () => {
    // Seed the config module before terminal-service loads
    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return {
        ...original,
        getConfig: vi.fn().mockReturnValue({ scrollback: 25000 }),
      };
    });

    mockIPC((cmd) => {
      if (cmd === "spawn_pty") return 1;
      return undefined;
    });

    const { createTerminalSurface } = await import("../lib/terminal-service");

    const pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane as never);

    expect(surface.terminal.options.scrollback).toBe(25000);
  });

  it("defaults to 10000 when config.scrollback is not set", async () => {
    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return {
        ...original,
        getConfig: vi.fn().mockReturnValue({}),
      };
    });

    mockIPC((cmd) => {
      if (cmd === "spawn_pty") return 1;
      return undefined;
    });

    const { createTerminalSurface } = await import("../lib/terminal-service");

    const pane = { id: "p2", surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane as never);

    expect(surface.terminal.options.scrollback).toBe(10000);
  });
});

// ─── Change 2: Shell path ─────────────────────────────────────────────────────

describe("connectPty passes shell from config to spawn_pty", () => {
  it("passes config.shell to spawn_pty when set", async () => {
    const spawnCalls: { shell: string | null | undefined }[] = [];

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({ shell: a.shell as string | null | undefined });
        return 1;
      }
      return undefined;
    });

    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return {
        ...original,
        getConfig: vi.fn().mockReturnValue({ shell: "/usr/local/bin/fish" }),
      };
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].shell).toBe("/usr/local/bin/fish");
  });

  it("passes null to spawn_pty when config.shell is not set", async () => {
    const spawnCalls: { shell: string | null | undefined }[] = [];

    mockIPC((cmd, args) => {
      const a = args as Record<string, unknown>;
      if (cmd === "spawn_pty") {
        spawnCalls.push({ shell: a.shell as string | null | undefined });
        return 2;
      }
      return undefined;
    });

    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return {
        ...original,
        getConfig: vi.fn().mockReturnValue({}),
      };
    });

    const { connectPty } = await import("../lib/terminal-service");

    const surface = {
      ptyId: -1,
      terminal: { cols: 80, rows: 24 },
    } as unknown as Parameters<typeof connectPty>[0];

    await connectPty(surface);

    expect(spawnCalls).toHaveLength(1);
    // null or undefined — both mean "use system default"
    expect(spawnCalls[0].shell == null).toBe(true);
  });
});

// ─── Change 3: Copy-on-select ─────────────────────────────────────────────────

describe("copy-on-select wires onSelectionChange to clipboard write", () => {
  it("writes selection to clipboard when text is selected", async () => {
    // Capture the selection-change handler registered by createTerminalSurface
    let selectionChangeHandler: (() => void) | null = null;

    // Mock xterm Terminal so we can capture the onSelectionChange callback
    vi.doMock("@xterm/xterm", () => ({
      Terminal: class {
        open = vi.fn();
        write = vi.fn();
        focus = vi.fn();
        dispose = vi.fn();
        cols = 80;
        rows = 24;
        onData = vi.fn();
        onResize = vi.fn();
        onTitleChange = vi.fn();
        onSelectionChange = vi.fn().mockImplementation((cb: () => void) => {
          selectionChangeHandler = cb;
        });
        loadAddon = vi.fn();
        options: Record<string, unknown> = {};
        buffer = { active: { getLine: vi.fn() } };
        parser = { registerOscHandler: vi.fn() };
        attachCustomKeyEventHandler = vi.fn();
        registerLinkProvider = vi.fn();
        getSelection = vi.fn().mockReturnValue("selected text");
        hasSelection = vi.fn().mockReturnValue(true);
        scrollToBottom = vi.fn();
        clear = vi.fn();
      },
    }));
    vi.doMock("@xterm/addon-fit", () => ({
      FitAddon: class {
        fit = vi.fn();
        activate = vi.fn();
        dispose = vi.fn();
      },
    }));
    vi.doMock("@xterm/addon-web-links", () => ({
      WebLinksAddon: class {
        activate = vi.fn();
        dispose = vi.fn();
      },
    }));
    vi.doMock("@xterm/addon-search", () => ({
      SearchAddon: class {
        activate = vi.fn();
        dispose = vi.fn();
        findNext = vi.fn();
        findPrevious = vi.fn();
        clearDecorations = vi.fn();
      },
    }));
    vi.doMock("@xterm/xterm/css/xterm.css", () => ({}));

    // Mock clipboard write
    const clipboardWrites: string[] = [];
    vi.doMock("@tauri-apps/plugin-clipboard-manager", () => ({
      readText: vi.fn().mockResolvedValue(""),
      writeText: vi.fn().mockImplementation((text: string) => {
        clipboardWrites.push(text);
        return Promise.resolve();
      }),
    }));

    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return {
        ...original,
        getConfig: vi.fn().mockReturnValue({}),
      };
    });

    mockIPC((cmd) => {
      if (cmd === "spawn_pty") return 1;
      return undefined;
    });

    const { createTerminalSurface } = await import("../lib/terminal-service");

    const pane = { id: "p3", surfaces: [], activeSurfaceId: null };
    await createTerminalSurface(pane as never);

    // The handler should have been registered
    expect(selectionChangeHandler).not.toBeNull();

    // Fire the captured handler
    selectionChangeHandler!();

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(clipboardWrites).toContain("selected text");
  });

  it("does NOT write to clipboard when hasSelection() returns false", async () => {
    let selectionChangeHandler: (() => void) | null = null;

    vi.doMock("@xterm/xterm", () => ({
      Terminal: class {
        open = vi.fn();
        write = vi.fn();
        focus = vi.fn();
        dispose = vi.fn();
        cols = 80;
        rows = 24;
        onData = vi.fn();
        onResize = vi.fn();
        onTitleChange = vi.fn();
        onSelectionChange = vi.fn().mockImplementation((cb: () => void) => {
          selectionChangeHandler = cb;
        });
        loadAddon = vi.fn();
        options: Record<string, unknown> = {};
        buffer = { active: { getLine: vi.fn() } };
        parser = { registerOscHandler: vi.fn() };
        attachCustomKeyEventHandler = vi.fn();
        registerLinkProvider = vi.fn();
        getSelection = vi.fn().mockReturnValue("");
        hasSelection = vi.fn().mockReturnValue(false); // empty selection
        scrollToBottom = vi.fn();
        clear = vi.fn();
      },
    }));
    vi.doMock("@xterm/addon-fit", () => ({
      FitAddon: class {
        fit = vi.fn();
        activate = vi.fn();
        dispose = vi.fn();
      },
    }));
    vi.doMock("@xterm/addon-web-links", () => ({
      WebLinksAddon: class {
        activate = vi.fn();
        dispose = vi.fn();
      },
    }));
    vi.doMock("@xterm/addon-search", () => ({
      SearchAddon: class {
        activate = vi.fn();
        dispose = vi.fn();
        findNext = vi.fn();
        findPrevious = vi.fn();
        clearDecorations = vi.fn();
      },
    }));
    vi.doMock("@xterm/xterm/css/xterm.css", () => ({}));

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@tauri-apps/plugin-clipboard-manager", () => ({
      readText: vi.fn().mockResolvedValue(""),
      writeText: writeTextMock,
    }));

    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return { ...original, getConfig: vi.fn().mockReturnValue({}) };
    });

    mockIPC((cmd) => {
      if (cmd === "spawn_pty") return 1;
      return undefined;
    });

    const { createTerminalSurface } = await import("../lib/terminal-service");
    const pane = { id: "p5", surfaces: [], activeSurfaceId: null };
    await createTerminalSurface(pane as never);

    expect(selectionChangeHandler).not.toBeNull();
    selectionChangeHandler!();

    await new Promise((r) => setTimeout(r, 0));

    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("registers onSelectionChange handler during surface creation", async () => {
    vi.doMock("../lib/config", async (importOriginal) => {
      const original = await importOriginal<typeof import("../lib/config")>();
      return {
        ...original,
        getConfig: vi.fn().mockReturnValue({}),
      };
    });

    mockIPC((cmd) => {
      if (cmd === "spawn_pty") return 1;
      return undefined;
    });

    const { createTerminalSurface } = await import("../lib/terminal-service");

    const pane = { id: "p4", surfaces: [], activeSurfaceId: null };

    // Verify onSelectionChange is a function on the created surface's terminal
    const surface = await createTerminalSurface(pane as never);
    expect(typeof surface.terminal.onSelectionChange).toBe("function");
  });
});
