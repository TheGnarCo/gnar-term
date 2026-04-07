/**
 * Paste regression tests — exercises the actual key handler and onData code
 * paths to verify clipboard paste writes to PTY exactly once.
 *
 * Bug: Cmd+V read clipboard and wrote to PTY, but didn't call preventDefault,
 * so the browser paste event also fired through onData → second write_pty.
 * Fix: preventDefault on Cmd+V and Ctrl+Shift+V.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue("pasted text"),
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24,
    onData: vi.fn(),
    onResize: vi.fn(),
    onTitleChange: vi.fn(),
    loadAddon: vi.fn(),
    options: {},
    buffer: { active: { getLine: vi.fn() } },
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn().mockReturnValue("selected text"),
    scrollToBottom: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(), activate: vi.fn(), dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(), dispose: vi.fn(), onContextLoss: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(), dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(), dispose: vi.fn(),
    findNext: vi.fn(), findPrevious: vi.fn(), clearDecorations: vi.fn(),
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
    observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
  })),
);

import { invoke } from "@tauri-apps/api/core";
import { readText as clipboardRead, writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { createTerminalSurface, isMac } from "../lib/terminal-service";
import type { Pane } from "../lib/types";
import { uid } from "../lib/types";

// Platform-aware modifier key for tests: Cmd on macOS, Ctrl on Linux/Windows
const cmdKeyProp = isMac ? "metaKey" : "ctrlKey";

describe("Paste — single write to PTY via Tauri clipboard plugin", () => {
  let keyHandler: (e: KeyboardEvent) => boolean;
  let onDataHandler: (data: string) => void;
  let surface: Awaited<ReturnType<typeof createTerminalSurface>>;

  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined as any);
    vi.mocked(clipboardRead).mockClear();
    vi.mocked(clipboardWrite).mockClear();

    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    surface = await createTerminalSurface(pane);
    (surface as any).ptyId = 42;

    const termMock = surface.terminal as any;
    keyHandler = termMock.attachCustomKeyEventHandler.mock.calls[0][0];
    onDataHandler = termMock.onData.mock.calls[0][0];
  });

  describe("Cmd/Ctrl+V paste", () => {
    it("calls preventDefault to block browser paste event (prevents double-write)", () => {
      const event = new KeyboardEvent("keydown", { key: "v", [cmdKeyProp]: true });
      const spy = vi.spyOn(event, "preventDefault");
      keyHandler(event);
      expect(spy).toHaveBeenCalled();
    });

    it("reads clipboard via Tauri plugin and writes to PTY exactly once", async () => {
      const event = new KeyboardEvent("keydown", { key: "v", [cmdKeyProp]: true });
      keyHandler(event);

      // clipboardRead is async — wait for it to resolve
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("write_pty", { ptyId: 42, data: "pasted text" });
      });

      const writeCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "write_pty");
      expect(writeCalls).toHaveLength(1);
    });

    it("returns false to prevent xterm.js from also processing the keydown", () => {
      const event = new KeyboardEvent("keydown", { key: "v", [cmdKeyProp]: true });
      expect(keyHandler(event)).toBe(false);
    });

    it("does not write to PTY when clipboard is empty", async () => {
      vi.mocked(clipboardRead).mockResolvedValueOnce("");
      const event = new KeyboardEvent("keydown", { key: "v", [cmdKeyProp]: true });
      keyHandler(event);

      // Give the promise time to resolve
      await new Promise(r => setTimeout(r, 10));
      const writeCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "write_pty");
      expect(writeCalls).toHaveLength(0);
    });

    it("does not write to PTY when ptyId is -1 (disconnected)", async () => {
      (surface as any).ptyId = -1;
      const event = new KeyboardEvent("keydown", { key: "v", [cmdKeyProp]: true });
      keyHandler(event);

      await new Promise(r => setTimeout(r, 10));
      const writeCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "write_pty");
      expect(writeCalls).toHaveLength(0);
    });
  });

  describe("Ctrl+Shift+V paste (Linux)", () => {
    it("calls preventDefault and reads clipboard", async () => {
      const event = new KeyboardEvent("keydown", { key: "v", ctrlKey: true, shiftKey: true });
      const spy = vi.spyOn(event, "preventDefault");
      keyHandler(event);
      expect(spy).toHaveBeenCalled();

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("write_pty", { ptyId: 42, data: "pasted text" });
      });
    });
  });

  describe("Cmd/Ctrl+C copy", () => {
    it("writes selection to clipboard via Tauri plugin", () => {
      const event = new KeyboardEvent("keydown", { key: "c", [cmdKeyProp]: true });
      keyHandler(event);
      expect(clipboardWrite).toHaveBeenCalledWith("selected text");
    });

    it("returns false to prevent xterm.js from processing", () => {
      const event = new KeyboardEvent("keydown", { key: "c", [cmdKeyProp]: true });
      expect(keyHandler(event)).toBe(false);
    });
  });

  describe("Normal typing still works", () => {
    it("onData handler forwards typed characters to PTY", () => {
      onDataHandler("hello");
      expect(invoke).toHaveBeenCalledWith("write_pty", { ptyId: 42, data: "hello" });
    });

    it("onData handler does not forward when PTY disconnected", () => {
      (surface as any).ptyId = -1;
      onDataHandler("hello");
      expect(invoke).not.toHaveBeenCalledWith("write_pty", expect.anything());
    });
  });
});
