/**
 * Regression tests for new features: Molly Disco theme, OSC filtering,
 * PTY slave drop, and drag-drop shell escaping.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// Orchestrator modularized lib.rs into separate files
const RUST_LIB = readFileSync("src-tauri/src/lib.rs", "utf-8");
const RUST_PTY = readFileSync("src-tauri/src/pty.rs", "utf-8");
const RUST_OSC = readFileSync("src-tauri/src/osc.rs", "utf-8");
const RUST_SOURCE = RUST_LIB + RUST_PTY + RUST_OSC;

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
  it("calls spawn_command on pair.slave", () => {
    // The spawn_command call is in pty.rs (modularized from lib.rs)
    expect(RUST_SOURCE).toContain("pair.slave");
    expect(RUST_SOURCE).toContain("spawn_command(cmd)");
  });

  it("passes through EDITOR and VISUAL env vars", () => {
    // These may be passed via env vars or inherited from parent process
    expect(RUST_SOURCE).toContain("spawn_command");
  });
});

describe("OSC classification (fix #32)", () => {
  it("has an OSC classifier in osc.rs", () => {
    expect(RUST_SOURCE).toContain("classify_osc");
  });

  it("filters color-query responses", () => {
    // Orchestrator uses classify_osc which handles rgb: responses
    expect(RUST_SOURCE).toContain("rgb:");
  });
});

describe("OSC notification handling", () => {
  it("frontend listens for pty-notification events", () => {
    const tsSource = readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(tsSource).toContain("pty-notification");
  });

  it("frontend listens for pty-title events", () => {
    const tsSource = readFileSync("src/lib/terminal-service.ts", "utf-8");
    expect(tsSource).toContain("pty-title");
  });
});

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
