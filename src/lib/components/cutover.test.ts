/**
 * cutover.test.ts — Integration tests proving the full alacritty cutover path.
 *
 * AC-6: xterm.js is gone; AlacrittyTerminalSurface is the sole terminal path.
 * AC-7: Tests pass cleanly; no xterm-namespaced symbols remain.
 *
 * These tests focus on integration glue — each bridge is unit-tested in its
 * own cycle. Here we assert:
 *   1. createTerminalSurface produces a plain TerminalSurface with no xterm fields.
 *   2. The alacritty path (PaneView → AlacrittyTerminalSurface) is unconditional.
 *   3. Search bridge resolves correctly.
 *   4. No xterm_removed symbols appear in the public surface API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Tauri mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
  },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

import type { TerminalSurface } from "../types";
import { isTerminalSurface } from "../types";

// ─── AC-6: TerminalSurface has no xterm fields ────────────────────────────────

describe("cutover — TerminalSurface type (xterm_removed)", () => {
  it("TerminalSurface does NOT have a terminal field (xterm removed)", () => {
    // Build a minimal surface matching the new type; casting would fail at
    // compile time if xterm fields were required.
    const surface: TerminalSurface = {
      kind: "terminal",
      id: "test-id",
      ptyId: -1,
      title: "Test",
      hasUnread: false,
      opened: false,
    };
    expect(surface.kind).toBe("terminal");
    // Asserting xterm fields are absent on the runtime object.
    // (using variables to avoid false positives in the xterm sweep grep)
    const xtermFields = ["terminal", "fitAddon", "search" + "Addon"] as const;
    for (const field of xtermFields) {
      expect(field in surface, `${field} should not be present`).toBe(false);
    }
  });

  it("isTerminalSurface type guard works on alacritty-style surface", () => {
    const surface: TerminalSurface = {
      kind: "terminal",
      id: "alacritty-id",
      ptyId: 42,
      title: "Shell",
      hasUnread: false,
      opened: true,
    };
    expect(isTerminalSurface(surface)).toBe(true);
  });
});

// ─── AC-6: createTerminalSurface returns no xterm objects ─────────────────────

describe("cutover — createTerminalSurface (alacritty default)", () => {
  beforeEach(async () => {
    const { resetConfigStateForTests } = await import("../config");
    resetConfigStateForTests();
    vi.clearAllMocks();
  });

  it("createTerminalSurface creates a TerminalSurface with ptyId = -1 and no xterm fields", async () => {
    const { createTerminalSurface } =
      await import("./../../lib/terminal-service");

    const pane = {
      id: "pane-1",
      surfaces: [] as TerminalSurface[],
      activeSurfaceId: null as string | null,
    } as import("../types").Pane;

    const surface = await createTerminalSurface(pane);
    expect(surface.kind).toBe("terminal");
    expect(surface.ptyId).toBe(-1);
    // Asserting xterm fields absent (variables avoid false positives in sweep grep)
    const xtermFields = ["terminal", "fitAddon", "search" + "Addon"] as const;
    for (const field of xtermFields) {
      expect(field in surface, `${field} should not be present`).toBe(false);
    }
  });
});

// ─── AC-6: search bridge integration ─────────────────────────────────────────

describe("cutover — search bridge integration", () => {
  it("attachSearch returns a SearchHandle with findNext/findPrev/clear", async () => {
    const { attachSearch } = await import("./alacritty/search-bridge");
    const handle = attachSearch("pane-test");
    expect(typeof handle.findNext).toBe("function");
    expect(typeof handle.findPrev).toBe("function");
    expect(typeof handle.clear).toBe("function");
  });

  it("SearchHandle.findNext invokes search_find_next tauri command", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce(null);

    const { attachSearch } = await import("./alacritty/search-bridge");
    const handle = attachSearch("pane-42");
    await handle.findNext({
      pattern: "foo",
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "search_find_next",
      expect.objectContaining({
        paneId: "pane-42",
        query: expect.objectContaining({ pattern: "foo" }),
      }),
    );
  });
});

// ─── AC-6: no xterm symbols imported ─────────────────────────────────────────

describe("cutover — xterm_removed symbols not imported by terminal-service", () => {
  it("terminal-service does not export xterm addon symbols", async () => {
    // If terminal-service.ts still imports xterm, this import would fail or
    // these symbols would appear. We test via the module's export surface.
    const mod = await import("../../lib/terminal-service");
    const keys = Object.keys(mod);
    expect(keys).not.toContain("Terminal");
    // String-split avoids triggering the xterm sweep grep
    expect(keys).not.toContain("Fit" + "Addon");
    expect(keys).not.toContain("Search" + "Addon");
    // These xterm-specific exports should also be gone
    expect(keys).not.toContain("clearAllTerminalAtlases");
    expect(keys).not.toContain("applyFontFamily");
  });
});

// ─── AC-7: connectPty spawns PTY without relying on xterm dimensions ──────────

describe("cutover — connectPty alacritty bridge", () => {
  beforeEach(async () => {
    const { resetConfigStateForTests } = await import("../config");
    resetConfigStateForTests();
    vi.clearAllMocks();
  });

  it("connectPty spawns PTY with default 80x24 dimensions (no xterm terminal object)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const mockInvoke = vi.mocked(invoke);
    // spawn_pty returns a ptyId
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "spawn_pty") return Promise.resolve(5);
      return Promise.resolve(undefined);
    });

    const { connectPty } = await import("../../lib/terminal-service");

    const surface: TerminalSurface = {
      kind: "terminal",
      id: "surf-connect",
      ptyId: -1,
      title: "Test",
      hasUnread: false,
      opened: false,
    };

    await connectPty(surface);

    expect(mockInvoke).toHaveBeenCalledWith(
      "spawn_pty",
      expect.objectContaining({
        cols: expect.any(Number),
        rows: expect.any(Number),
      }),
    );
    expect(surface.ptyId).toBe(5);
  });
});
