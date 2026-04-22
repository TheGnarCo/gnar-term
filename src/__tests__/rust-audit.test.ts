/**
 * Audit tests for Rust backend code quality.
 * Ensures no debug println! statements, no mutex unwrap, no duplicate OSC 7.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const RUST_SOURCE = readFileSync("src-tauri/src/lib.rs", "utf-8");

describe("Rust backend audit", () => {
  it("has no debug println! statements", () => {
    const lines = RUST_SOURCE.split("\n");
    const printlnLines = lines.filter(
      (line) => line.includes("println!") && !line.trim().startsWith("//") && !line.includes("[test]")
    );
    expect(printlnLines).toEqual([]);
  });

  it("has no .lock().unwrap() on mutex in production code (should use map_err)", () => {
    // Split source at #[cfg(test)] — only check production code before it
    const testBoundary = RUST_SOURCE.indexOf("#[cfg(test)]");
    const prodCode = testBoundary >= 0 ? RUST_SOURCE.slice(0, testBoundary) : RUST_SOURCE;
    const lines = prodCode.split("\n");
    const unwrapLockLines = lines.filter(
      line => line.includes(".lock().unwrap()") && !line.trim().startsWith("//")
    );
    expect(unwrapLockLines).toEqual([]);
  });

  it("registers clipboard plugin", () => {
    expect(RUST_SOURCE).toContain("tauri_plugin_clipboard_manager::init()");
  });

  it("has PredefinedMenuItem::copy and ::paste for native clipboard in WebView", () => {
    // Native menu Copy/Paste are required for non-terminal content (previews, etc.)
    // Terminal surfaces override via attachCustomKeyEventHandler.
    expect(RUST_SOURCE).toContain("PredefinedMenuItem::copy");
    expect(RUST_SOURCE).toContain("PredefinedMenuItem::paste");
  });

  it("has unwatch_file command for thread leak fix", () => {
    expect(RUST_SOURCE).toContain("unwatch_file");
  });

  it("has clipboard permissions in capabilities", () => {
    const capabilities = readFileSync("src-tauri/capabilities/default.json", "utf-8");
    expect(capabilities).toContain("clipboard-manager:allow-read-text");
    expect(capabilities).toContain("clipboard-manager:allow-write-text");
  });
});

describe("Frontend code quality", () => {
  it("no navigator.clipboard usage (should use Tauri plugin)", () => {
    const files = [
      "src/App.svelte",
      "src/lib/terminal-service.ts",
    ];
    for (const file of files) {
      try {
        const source = readFileSync(file, "utf-8");
        expect(source).not.toContain("navigator.clipboard");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  });

  it("no console.log debug lines in terminal service", () => {
    try {
      const source = readFileSync("src/lib/terminal-service.ts", "utf-8");
      const lines = source.split("\n");
      const debugLogs = lines.filter(
        line => line.includes("console.log") && !line.trim().startsWith("//")
      );
      expect(debugLogs).toEqual([]);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  });

  it("old dead code files are deleted", () => {
    const deadFiles = [
      "src/markdown-viewer.ts",
      "src/sidebar.ts",
      "src/command-palette.ts",
      "src/find-bar.ts",
      "src/context-menu.ts",
      "src/terminal-manager.ts",
      "src/theme.ts",
    ];
    for (const file of deadFiles) {
      expect(() => readFileSync(file, "utf-8")).toThrow();
    }
  });
});
