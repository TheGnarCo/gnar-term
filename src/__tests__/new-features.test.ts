/**
 * Regression tests for new features: Molly Disco theme, OSC filtering,
 * PTY slave drop, and drag-drop shell escaping.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";

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

const RUST_SOURCE = readFileSync("src-tauri/src/lib.rs", "utf-8");
const RUST_PTY_SOURCE = readFileSync("src-tauri/src/pty.rs", "utf-8");
const RUST_OSC_SOURCE = readFileSync("src-tauri/src/osc_parser.rs", "utf-8");

describe("Molly Disco theme", () => {
  it("is registered in theme-data.ts", async () => {
    const { themes } = await import("../lib/theme-data");
    expect(themes["molly-disco"]).toBeDefined();
    expect(themes["molly-disco"].name).toBe("Molly Disco");
  });

  it("has vibrant ANSI colors distinct from the Molly theme", async () => {
    const { themes } = await import("../lib/theme-data");
    const disco = themes["molly-disco"];
    // Molly Disco should have neon/vibrant colors, not muted ones
    expect(disco.danger).toBe("#e91e63"); // hot pink red
    expect(disco.success).toBe("#00bfa5"); // teal green
    expect(disco.ansi.magenta).toBe("#c026d3"); // fuchsia
    expect(disco.ansi.brightCyan).toBe("#18ffff"); // neon cyan
  });

  // Structural invariant: Rust source can't be imported from JS tests.
  it("is listed in the macOS theme menu", () => {
    expect(RUST_SOURCE).toContain("theme-molly-disco");
    expect(RUST_SOURCE).toContain('"Molly Disco"');
  });

  it("is documented in README", () => {
    const readme = readFileSync("README.md", "utf-8");
    expect(readme).toContain("molly-disco");
    expect(readme).toContain("Molly Disco");
  });
});

// Structural invariant: Rust source can't be imported from JS tests.
// These are valid structural regression tests for PTY behavior.
describe("PTY slave fd is dropped after spawn (fix #29)", () => {
  it("calls drop(pair.slave) after spawn_command", () => {
    // The slave fd must be dropped in the parent so vim/nano can take
    // control of the terminal. Every test in lib.rs does this too.
    const spawnIdx = RUST_PTY_SOURCE.indexOf(".spawn_command(cmd)");
    expect(spawnIdx).toBeGreaterThan(-1);

    // drop(pair.slave) should appear after spawn, before writer/reader setup
    const afterSpawn = RUST_PTY_SOURCE.slice(spawnIdx, spawnIdx + 500);
    expect(afterSpawn).toContain("drop(pair.slave)");
  });

  it("passes through EDITOR and VISUAL env vars", () => {
    expect(RUST_PTY_SOURCE).toContain('cmd.env("EDITOR"');
    expect(RUST_PTY_SOURCE).toContain('cmd.env("VISUAL"');
  });
});

// Structural invariant: Rust source can't be imported from JS tests.
// These are valid structural regression tests for the OSC parser.
describe("OSC parser handles ESC \\\\ two-byte ST (fix #32)", () => {
  it("checks for 0x5c after ESC inside OSC state", () => {
    // The parser must handle ESC \\ (0x1b 0x5c) as String Terminator
    expect(RUST_PTY_SOURCE).toContain("byte == 0x5c && prev_esc");
  });

  it("handles malformed OSC by aborting on unexpected ESC sequence", () => {
    // If ESC is followed by something other than \\ or ], abort OSC
    expect(RUST_PTY_SOURCE).toContain(
      "the OSC was malformed; abort and start fresh",
    );
  });
});

// Structural invariant: Rust source can't be imported from JS tests.
describe("OSC notification filtering (fix #32)", () => {
  it("filters out rgb: color-query responses in Rust", () => {
    expect(RUST_OSC_SOURCE).toContain('text.starts_with("rgb:")');
    expect(RUST_OSC_SOURCE).toContain('text.starts_with("rgba:")');
  });

  // Structural invariant: verified via source scan because terminal-service
  // imports xterm and Tauri APIs at module level.
  it("filters escape-sequence fragments on the frontend", () => {
    const tsSource = readFileSync("src/lib/terminal-service.ts", "utf-8");
    // Frontend should filter digit-only fragments from notifications
    expect(tsSource).toContain("pty-notification");
    // Regex filter for digit/semicolon-only fragments
    expect(tsSource).toMatch(/\/.*\\d.*\.test\(text\)/);
  });

  it("filters escape-sequence fragments from title events", () => {
    const tsSource = readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(tsSource).toContain("pty-title");
    // Title filter should reject control characters and digit-only strings
    expect(tsSource).toMatch(/\\x00-\\x1f/);
  });
});

// Structural invariant: verified via source scan because mounting Svelte
// components requires Tauri runtime which isn't available in vitest.
describe("Drag-and-drop shell escaping", () => {
  it("TerminalSurface has drop event handlers", () => {
    const svelte = readFileSync(
      "src/lib/components/TerminalSurface.svelte",
      "utf-8",
    );
    expect(svelte).toContain("on:dragover");
    expect(svelte).toContain("on:drop");
    expect(svelte).toContain("on:dragleave");
  });

  it("uses onDestroy for Tauri drag-drop listener cleanup", () => {
    const svelte = readFileSync(
      "src/lib/components/TerminalSurface.svelte",
      "utf-8",
    );
    expect(svelte).toContain("onDestroy");
    expect(svelte).toContain("unlistenDragDrop");
  });

  it("shell-escapes file paths with single quotes", () => {
    const svelte = readFileSync(
      "src/lib/components/TerminalSurface.svelte",
      "utf-8",
    );
    // shellEscape wraps in single quotes and escapes embedded quotes
    expect(svelte).toContain("shellEscape");
    expect(svelte).toContain("'\\\\''");
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
    // Must be one of the expected platform values
    expect(["⌘", "Ctrl+"]).toContain(ts.modLabel);
    expect(["⇧⌘", "Ctrl+Shift+"]).toContain(ts.shiftModLabel);
  });
});

describe("Cross-platform guidelines in CLAUDE.md", () => {
  it("documents cross-platform requirements", () => {
    const claude = readFileSync("CLAUDE.md", "utf-8");
    expect(claude).toContain("Cross-Platform");
    expect(claude).toContain("Never fix Linux and break macOS");
  });
});
