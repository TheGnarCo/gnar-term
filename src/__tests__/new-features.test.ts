/**
 * Behavioral regression tests for theme and platform-detection
 * features. (Source-scan structural tests for PTY / OSC / drag-drop
 * were removed — they verified file text, not behavior.)
 */

import { describe, it, expect, vi } from "vitest";

// Mock Tauri APIs before any imports that use them
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

describe("Molly Disco theme", () => {
  it("is registered in theme-data.ts", async () => {
    const { themes } = await import("../lib/theme-data");
    expect(themes["molly-disco"]).toBeDefined();
    expect(themes["molly-disco"].name).toBe("Molly Disco");
  });

  it("has vibrant ANSI colors distinct from the Molly theme", async () => {
    const { themes } = await import("../lib/theme-data");
    const disco = themes["molly-disco"];
    expect(disco.danger).toBe("#e91e63"); // hot pink red
    expect(disco.success).toBe("#00bfa5"); // teal green
    expect(disco.ansi.magenta).toBe("#c026d3"); // fuchsia
    expect(disco.ansi.brightCyan).toBe("#18ffff"); // neon cyan
  });
});

describe("Platform detection", () => {
  it("exports isMac from terminal-service", async () => {
    const ts = await import("../lib/terminal-service");
    expect(typeof ts.isMac).toBe("boolean");
  });

  it("exports modLabel and shiftModLabel for shortcut display", async () => {
    const ts = await import("../lib/terminal-service");
    expect(typeof ts.modLabel).toBe("string");
    expect(typeof ts.shiftModLabel).toBe("string");
    expect(["⌘", "Ctrl+"]).toContain(ts.modLabel);
    expect(["⇧⌘", "Ctrl+Shift+"]).toContain(ts.shiftModLabel);
  });
});
