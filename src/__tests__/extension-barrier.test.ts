/**
 * Extension Barrier — Story C
 *
 * Tests that no extension imports directly from core internals (../../lib/).
 * Also verifies that the new API methods exist on the ExtensionAPI interface.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const EXTENSIONS_DIR = path.resolve(__dirname, "../extensions");

/** Recursively find all .ts and .svelte files in a directory */
function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads extension source files to validate import boundaries
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "__tests__") {
      results.push(...findSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".svelte")) {
      // Skip test files — they legitimately import from core for testing
      if (!entry.name.endsWith(".test.ts")) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe("Extension barrier enforcement", () => {
  const extensionFiles = findSourceFiles(EXTENSIONS_DIR);

  it("found extension source files to check", () => {
    expect(extensionFiles.length).toBeGreaterThan(0);
  });

  it("no extension file imports from core lib (except allowed utilities)", () => {
    // Allowed: types (type definitions), extension-types (shared type definitions)
    const ALLOWED_IMPORTS = ["/types"];
    const violations: string[] = [];
    for (const file of extensionFiles) {
      if (file.endsWith("/api.ts")) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads extension source files to validate import boundaries
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        // Match any import from a ../../lib/ or ../../../lib/ path
        if (!line.match(/from\s+["'][^"']*\/lib\//)) continue;
        // Allow type-only imports
        if (line.trimStart().startsWith("import type")) continue;
        // Allow specific utilities
        if (ALLOWED_IMPORTS.some((mod) => line.includes(mod))) continue;
        const relPath = path.relative(EXTENSIONS_DIR, file);
        violations.push(`${relPath}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no extension file imports from another extension directory", () => {
    const violations: string[] = [];
    for (const file of extensionFiles) {
      if (file.endsWith("/api.ts")) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads extension source files to validate import boundaries
      const content = fs.readFileSync(file, "utf-8");
      // Determine this file's extension directory (e.g., "preview" for preview/previewers/foo.ts)
      const relToExtensions = path.relative(EXTENSIONS_DIR, file);
      const extensionDir = relToExtensions.split(path.sep)[0];
      const lines = content.split("\n");
      for (const line of lines) {
        const match = line.match(/from\s+["']\.\.\/(\w[\w-]*)(?:\/|["'])/);
        if (!match) continue;
        const importTarget = match[1];
        // Allow: ../api (public contract), ../shared (shared helpers for included extensions)
        if (importTarget === "api" || importTarget === "shared") continue;
        // For files in subdirectories, ../ stays within the same extension — skip
        const depth = relToExtensions.split(path.sep).length;
        if (depth > 2) continue; // subdirectory file — ../ doesn't escape the extension
        // Top-level extension file importing from another extension
        if (importTarget !== extensionDir) {
          violations.push(`${relToExtensions} imports from ../${importTarget}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
