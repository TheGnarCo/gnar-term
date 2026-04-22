/**
 * Regression tests for new features: Molly Disco theme, OSC filtering,
 * PTY slave drop, and drag-drop shell escaping.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const RUST_SOURCE = readFileSync("src-tauri/src/lib.rs", "utf-8");

describe("Molly Disco theme", () => {
  it("is registered in theme-data.ts", () => {
    const themeData = readFileSync("src/lib/theme-data.ts", "utf-8");
    expect(themeData).toContain('"molly-disco"');
    expect(themeData).toContain('name: "Molly Disco"');
  });

  it("has vibrant ANSI colors distinct from the Molly theme", () => {
    const themeData = readFileSync("src/lib/theme-data.ts", "utf-8");
    // Molly Disco should have neon/vibrant colors, not muted ones
    expect(themeData).toContain("#e91e63"); // hot pink red
    expect(themeData).toContain("#00bfa5"); // teal green
    expect(themeData).toContain("#c026d3"); // fuchsia
    expect(themeData).toContain("#18ffff"); // neon cyan
  });

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

describe("PTY slave fd is dropped after spawn (fix #29)", () => {
  it("calls drop(pair.slave) after spawn_command", () => {
    // The slave fd must be dropped in the parent so vim/nano can take
    // control of the terminal. Every test in lib.rs does this too.
    const spawnIdx = RUST_SOURCE.indexOf("pair.slave\n        .spawn_command(cmd)");
    expect(spawnIdx).toBeGreaterThan(-1);

    // drop(pair.slave) should appear after spawn, before writer/reader setup
    const afterSpawn = RUST_SOURCE.slice(spawnIdx, spawnIdx + 500);
    expect(afterSpawn).toContain("drop(pair.slave)");
  });

  it("passes through EDITOR and VISUAL env vars", () => {
    expect(RUST_SOURCE).toContain('cmd.env("EDITOR"');
    expect(RUST_SOURCE).toContain('cmd.env("VISUAL"');
  });
});

describe("OSC parser handles ESC \\\\ two-byte ST (fix #32)", () => {
  it("checks for 0x5c after ESC inside OSC state", () => {
    // The parser must handle ESC \\ (0x1b 0x5c) as String Terminator
    expect(RUST_SOURCE).toContain("byte == 0x5c && prev_esc");
  });

  it("handles malformed OSC by aborting on unexpected ESC sequence", () => {
    // If ESC is followed by something other than \\ or ], abort OSC
    expect(RUST_SOURCE).toContain("the OSC was malformed; abort and start fresh");
  });
});

describe("OSC notification filtering (fix #32)", () => {
  it("filters out rgb: color-query responses in Rust", () => {
    expect(RUST_SOURCE).toContain('text.starts_with("rgb:")');
    expect(RUST_SOURCE).toContain('text.starts_with("rgba:")');
  });

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

describe("Drag-and-drop shell escaping", () => {
  it("TerminalSurface has drop event handlers", () => {
    const svelte = readFileSync("src/lib/components/TerminalSurface.svelte", "utf-8");
    expect(svelte).toContain("on:dragover");
    expect(svelte).toContain("on:drop");
    expect(svelte).toContain("on:dragleave");
  });

  it("uses onDestroy for Tauri drag-drop listener cleanup", () => {
    const svelte = readFileSync("src/lib/components/TerminalSurface.svelte", "utf-8");
    expect(svelte).toContain("onDestroy");
    expect(svelte).toContain("unlistenDragDrop");
  });

  it("shell-escapes file paths with single quotes", () => {
    const svelte = readFileSync("src/lib/components/TerminalSurface.svelte", "utf-8");
    // shellEscape wraps in single quotes and escapes embedded quotes
    expect(svelte).toContain("shellEscape");
    expect(svelte).toContain("'\\\\''");
  });
});

describe("Platform detection", () => {
  it("exports isMac from terminal-service", () => {
    const tsSource = readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(tsSource).toContain("export const isMac");
  });

  it("exports modLabel and shiftModLabel for shortcut display", () => {
    const tsSource = readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(tsSource).toContain("export const modLabel");
    expect(tsSource).toContain("export const shiftModLabel");
  });
});

describe("Cross-platform guidelines in CLAUDE.md", () => {
  it("documents cross-platform requirements", () => {
    const claude = readFileSync("CLAUDE.md", "utf-8");
    expect(claude).toContain("Cross-Platform");
    expect(claude).toContain("Never fix Linux and break macOS");
  });
});
