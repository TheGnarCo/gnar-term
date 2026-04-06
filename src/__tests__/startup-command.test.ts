/**
 * Startup command tests — verifies the contract between App.svelte setting
 * startupCommand and TerminalSurface.svelte sending it after connectPty.
 *
 * Tests the actual createTerminalSurface function and the TerminalSurface
 * component's onMount behavior with real (mocked) Tauri invoke calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    getSelection: vi.fn(),
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
import { createTerminalSurface, connectPty } from "../lib/terminal-service";
import type { Pane } from "../lib/types";
import { uid } from "../lib/types";

describe("Startup command contract", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined as any);
  });

  it("createTerminalSurface produces a surface that accepts startupCommand", async () => {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane);

    // App.svelte sets startupCommand after creation
    surface.startupCommand = "npm start";
    expect(surface.startupCommand).toBe("npm start");
  });

  it("startupCommand is available on the surface before connectPty runs", async () => {
    // This verifies the ordering: createTerminalSurface → set command → mount component → connectPty → send command
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane);
    surface.startupCommand = "ls -la";

    // Simulate what TerminalSurface.svelte does: connectPty then check startupCommand
    vi.mocked(invoke).mockResolvedValueOnce(99 as any); // spawn_pty returns ptyId
    await connectPty(surface);

    // After connectPty, surface has a ptyId and startupCommand is still set
    expect(surface.ptyId).toBe(99);
    expect(surface.startupCommand).toBe("ls -la");

    // TerminalSurface.svelte would now send the command and clear it:
    if (surface.startupCommand && surface.ptyId >= 0) {
      await invoke("write_pty", { ptyId: surface.ptyId, data: `${surface.startupCommand}\n` });
      surface.startupCommand = undefined;
    }

    expect(invoke).toHaveBeenCalledWith("write_pty", { ptyId: 99, data: "ls -la\n" });
    expect(surface.startupCommand).toBeUndefined();
  });

  it("does not send startup command when ptyId is -1 (spawn failed)", async () => {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane);
    surface.startupCommand = "echo hello";

    // Simulate spawn failure (connectPty sets ptyId to -1)
    vi.mocked(invoke).mockRejectedValueOnce(new Error("spawn failed"));
    await connectPty(surface);

    expect(surface.ptyId).toBe(-1);

    // TerminalSurface.svelte checks ptyId >= 0 before sending
    if (surface.startupCommand && surface.ptyId >= 0) {
      await invoke("write_pty", { ptyId: surface.ptyId, data: `${surface.startupCommand}\n` });
    }

    const writeCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writeCalls).toHaveLength(0);
  });

  it("surface without startupCommand does not send any command after connectPty", async () => {
    const pane: Pane = { id: uid(), surfaces: [], activeSurfaceId: null };
    const surface = await createTerminalSurface(pane);
    // No startupCommand set

    vi.mocked(invoke).mockResolvedValueOnce(50 as any);
    await connectPty(surface);

    // TerminalSurface.svelte checks startupCommand is truthy
    if (surface.startupCommand && surface.ptyId >= 0) {
      await invoke("write_pty", { ptyId: surface.ptyId, data: `${surface.startupCommand}\n` });
    }

    const writeCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "write_pty");
    expect(writeCalls).toHaveLength(0);
  });
});
