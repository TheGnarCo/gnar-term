/**
 * Audit tests for Rust backend code quality.
 * Ensures no debug println! statements, no mutex unwrap, no duplicate OSC 7.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// The audit covers the entire Rust backend, not just lib.rs. Commands and
// helpers were extracted into sibling modules (pty.rs, fs_commands.rs,
// file_watch.rs, …) so we concatenate every `*.rs` under `src-tauri/src`.
const RUST_SRC_DIR = "src-tauri/src";
const RUST_SOURCE = readdirSync(RUST_SRC_DIR)
  .filter((f) => f.endsWith(".rs"))
  .map((f) => readFileSync(join(RUST_SRC_DIR, f), "utf-8"))
  .join("\n");

// Strip every `#[cfg(test)] mod tests { ... }` block. Each Rust source file
// hosts its own test mod, so a single `indexOf("#[cfg(test)]")` split won't
// work once we concatenate multiple files. We walk the source, find each
// `#[cfg(test)]` marker, then skip past the matching `}` for the following
// module by tracking brace depth. Strings inside test code don't matter for
// our coarse audits (println! / .lock().unwrap()).
function stripTestMods(src: string): string {
  const out: string[] = [];
  let i = 0;
  const marker = "#[cfg(test)]";
  while (i < src.length) {
    const next = src.indexOf(marker, i);
    if (next < 0) {
      out.push(src.slice(i));
      break;
    }
    out.push(src.slice(i, next));
    // Find the opening brace of the test mod that follows the marker.
    const braceOpen = src.indexOf("{", next);
    if (braceOpen < 0) {
      // Malformed; bail and include remainder.
      out.push(src.slice(next));
      break;
    }
    let depth = 1;
    let j = braceOpen + 1;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    i = j;
  }
  return out.join("");
}

const RUST_PROD_SOURCE = stripTestMods(RUST_SOURCE);

describe("Rust backend audit", () => {
  it("has no debug println! statements in production code", () => {
    const lines = RUST_PROD_SOURCE.split("\n");
    const printlnLines = lines.filter(
      (line) => /\bprintln!/.test(line) && !line.trim().startsWith("//"),
    );
    expect(printlnLines).toEqual([]);
  });

  it("has no .lock().unwrap() on mutex in production code (should use map_err)", () => {
    const lines = RUST_PROD_SOURCE.split("\n");
    const unwrapLockLines = lines.filter(
      (line) =>
        line.includes(".lock().unwrap()") && !line.trim().startsWith("//"),
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
    const capabilities = readFileSync(
      "src-tauri/capabilities/default.json",
      "utf-8",
    );
    expect(capabilities).toContain("clipboard-manager:allow-read-text");
    expect(capabilities).toContain("clipboard-manager:allow-write-text");
  });

  it("registers open_url command", () => {
    expect(RUST_SOURCE).toContain("async fn open_url(");
    expect(RUST_SOURCE).toContain("open_url,");
  });
});

describe("Frontend code quality", () => {
  it("no navigator.clipboard usage (should use Tauri plugin)", () => {
    const files = ["src/App.svelte", "src/lib/terminal-service.ts"];
    for (const file of files) {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- hardcoded test file paths
        const source = readFileSync(file, "utf-8");
        expect(source).not.toContain("navigator.clipboard");
      } catch (e: unknown) {
        if (
          e instanceof Error &&
          (e as NodeJS.ErrnoException).code !== "ENOENT"
        )
          throw e;
      }
    }
  });

  it("no console.log debug lines in terminal service", () => {
    try {
      const source = readFileSync("src/lib/terminal-service.ts", "utf-8");
      const lines = source.split("\n");
      const debugLogs = lines.filter(
        (line) => line.includes("console.log") && !line.trim().startsWith("//"),
      );
      expect(debugLogs).toEqual([]);
    } catch (e: unknown) {
      if (e instanceof Error && (e as NodeJS.ErrnoException).code !== "ENOENT")
        throw e;
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
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- hardcoded test file paths
      expect(() => readFileSync(file, "utf-8")).toThrow();
    }
  });
});
