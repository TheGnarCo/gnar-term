/**
 * S3: Settings Foundation — verifies createBaseTerminal reads terminal settings.
 *
 * Tests that scrollback, cursorStyle, and cursorBlink are read from
 * getSettings().terminal instead of hardcoded values.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Terminal } from "@xterm/xterm";

// ---------------------------------------------------------------------------
// Mocks — must come before any source imports
// ---------------------------------------------------------------------------

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
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    onTitleChange: vi.fn(),
    loadAddon: vi.fn(),
    options: {},
    cols: 80,
    rows: 24,
    buffer: { active: { getLine: vi.fn() } },
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn(),
    scrollToBottom: vi.fn(),
    clear: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
  })),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// ---------------------------------------------------------------------------
// Source imports (after mocks)
// ---------------------------------------------------------------------------

import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../lib/types";
import { uid } from "../lib/types";
import { createHarnessSurface } from "../lib/terminal-service";
import {
  getSettings,
  loadSettings,
  saveSettings,
  _resetForTesting,
} from "../lib/settings";

const mockInvoke = vi.mocked(invoke);

function setupInvoke(files: Record<string, string>) {
  mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "get_home") return "/Users/test";
    if (cmd === "read_file") {
      const path = (args as any)?.path;
      if (path && files[path]) return files[path];
      throw new Error(`File not found: ${path}`);
    }
    if (cmd === "write_file") return undefined;
    if (cmd === "ensure_dir") return undefined;
    throw new Error(`Unknown command: ${cmd}`);
  });
}

function makePane(): Pane {
  return {
    id: uid(),
    surfaces: [],
    activeSurfaceId: null,
  };
}

const TerminalMock = vi.mocked(Terminal);

describe("createBaseTerminal reads terminal settings", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    _resetForTesting();
    TerminalMock.mockClear();
  });

  it("passes default scrollback, cursorStyle, cursorBlink to Terminal constructor", async () => {
    setupInvoke({});
    await loadSettings();

    const pane = makePane();
    await createHarnessSurface(pane, "claude");

    expect(TerminalMock).toHaveBeenCalledTimes(1);
    const opts = TerminalMock.mock.calls[0][0];
    expect(opts).toBeDefined();
    expect(opts!.scrollback).toBe(5000);
    expect(opts!.cursorStyle).toBe("block");
    expect(opts!.cursorBlink).toBe(true);
  });

  it("reads custom terminal settings from getSettings()", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        terminal: {
          scrollback: 10000,
          cursorStyle: "bar",
          cursorBlink: false,
        },
      }),
    });
    await loadSettings();

    const pane = makePane();
    await createHarnessSurface(pane, "claude");

    expect(TerminalMock).toHaveBeenCalledTimes(1);
    const opts = TerminalMock.mock.calls[0][0];
    expect(opts!.scrollback).toBe(10000);
    expect(opts!.cursorStyle).toBe("bar");
    expect(opts!.cursorBlink).toBe(false);
  });

  it("uses partial terminal overrides with remaining defaults", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        terminal: { scrollback: 2000 },
      }),
    });
    await loadSettings();

    const pane = makePane();
    await createHarnessSurface(pane, "claude");

    expect(TerminalMock).toHaveBeenCalledTimes(1);
    const opts = TerminalMock.mock.calls[0][0];
    expect(opts!.scrollback).toBe(2000);
    expect(opts!.cursorStyle).toBe("block");
    expect(opts!.cursorBlink).toBe(true);
  });

  it("reads underline cursorStyle", async () => {
    setupInvoke({
      "/Users/test/.config/gnar/settings.json": JSON.stringify({
        terminal: { cursorStyle: "underline" },
      }),
    });
    await loadSettings();

    const pane = makePane();
    await createHarnessSurface(pane, "claude");

    const opts = TerminalMock.mock.calls[0][0];
    expect(opts!.cursorStyle).toBe("underline");
  });
});
