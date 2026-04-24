/**
 * Regression tests for Linux keyboard shortcut handling.
 *
 * Verifies that:
 * - Plain Ctrl+key combos pass through to PTY (vim, readline, etc.)
 * - Ctrl+Shift+C/V are intercepted for clipboard
 * - Ctrl+Shift+T/N/D/etc. are intercepted for app shortcuts
 * - Platform detection correctly distinguishes macOS from Linux
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
// xterm + addon mocks. @xterm/xterm@6.1.0-beta.197 ships ESM exports
// that Svelte 5.55.4 invokes via `new`, so these must be real classes
// (not `vi.fn().mockImplementation(() => ({...}))` which fails with
// "is not a constructor" under the new codegen). Factories are
// inlined so vi.mock's hoisting rules don't trip up on top-level refs.
vi.mock("@xterm/xterm", () => ({
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
    loadAddon = vi.fn();
    options: Record<string, unknown> = {};
    buffer = { active: { getLine: vi.fn() } };
    parser = { registerOscHandler: vi.fn() };
    attachCustomKeyEventHandler = vi.fn();
    registerLinkProvider = vi.fn();
    getSelection = vi.fn().mockReturnValue("selected text");
    scrollToBottom = vi.fn();
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    onContextLoss = vi.fn();
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate = vi.fn();
    dispose = vi.fn();
    findNext = vi.fn();
    findPrevious = vi.fn();
    clearDecorations = vi.fn();
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

import { createTerminalSurface, isMac } from "../lib/terminal-service";
import type { Pane } from "../lib/types";
import { uid } from "../lib/types";

describe("Linux keyboard shortcut handling", () => {
  let keyHandler: (e: KeyboardEvent) => boolean;

  beforeEach(async () => {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane);
    (surface as unknown as { ptyId: number }).ptyId = 42;

    const termMock = surface.terminal as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    keyHandler = termMock.attachCustomKeyEventHandler.mock.calls[0][0];
  });

  describe("Plain Ctrl+key passes through to PTY (not intercepted)", () => {
    // These are essential terminal/TUI shortcuts that must reach the PTY
    const essentialCtrlKeys = [
      { key: "c", desc: "Ctrl+C (SIGINT)" },
      { key: "d", desc: "Ctrl+D (EOF)" },
      { key: "z", desc: "Ctrl+Z (SIGTSTP)" },
      { key: "w", desc: "Ctrl+W (delete word)" },
      { key: "k", desc: "Ctrl+K (kill line)" },
      { key: "n", desc: "Ctrl+N (next history)" },
      { key: "p", desc: "Ctrl+P (prev history)" },
      { key: "b", desc: "Ctrl+B (back char)" },
      { key: "f", desc: "Ctrl+F (forward char)" },
    ];

    for (const { key, desc } of essentialCtrlKeys) {
      it(`${desc} passes through to PTY`, () => {
        const event = new KeyboardEvent("keydown", { key, ctrlKey: true });
        const result = keyHandler(event);
        if (isMac) {
          // On macOS, Ctrl+key always passes through (metaKey is false)
          expect(result).toBe(true);
        } else {
          // On Linux, plain Ctrl+key (no shift) must pass through
          expect(result).toBe(true);
        }
      });
    }
  });

  describe("Ctrl+Shift+C/V intercepted for clipboard", () => {
    it("Ctrl+Shift+C intercepts for copy", () => {
      const event = new KeyboardEvent("keydown", {
        key: "C",
        ctrlKey: true,
        shiftKey: true,
      });
      expect(keyHandler(event)).toBe(false);
    });

    it("Ctrl+Shift+V intercepts for paste", () => {
      const event = new KeyboardEvent("keydown", {
        key: "V",
        ctrlKey: true,
        shiftKey: true,
      });
      expect(keyHandler(event)).toBe(false);
    });
  });

  if (!isMac) {
    describe("Ctrl+Shift+key intercepted for app shortcuts on Linux", () => {
      const appShortcuts = [
        "n",
        "t",
        "d",
        "w",
        "b",
        "p",
        "k",
        "f",
        "g",
        "h",
        "r",
      ];

      for (const key of appShortcuts) {
        it(`Ctrl+Shift+${key.toUpperCase()} intercepted for app`, () => {
          const event = new KeyboardEvent("keydown", {
            key,
            ctrlKey: true,
            shiftKey: true,
          });
          expect(keyHandler(event)).toBe(false);
        });
      }
    });
  }
});
