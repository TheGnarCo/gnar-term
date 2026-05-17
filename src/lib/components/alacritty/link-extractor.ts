/**
 * link-extractor.ts — cycle-18, AC-3
 *
 * Scans a `GridSnapshot` for URLs and file paths, returning a list of
 * `LinkMatch` objects that carry the matched text, its kind, and its
 * grid coordinates.
 *
 * Integration point for cycle-21:
 *   import { extractLinks, LinkMatch } from "./alacritty/link-extractor";
 *   // Call from AlacrittyTerminalSurface on snapshot/diff updates.
 *
 * Design note: this module is purely functional — no DOM, no Tauri, no
 * side-effects. The link-overlay module calls it and handles the DOM and
 * Tauri command dispatch.
 */

import type { GridSnapshot } from "../../types/terminal-ipc";

// ─── LinkMatch ────────────────────────────────────────────────────────────────

/**
 * A single detected link in the terminal grid.
 *
 * Coordinates are zero-based grid cell indices (row, col_start, col_end).
 * `col_end` is exclusive (matching the `DirtyRect` convention).
 */
export interface LinkMatch {
  /** Whether this link is a web URL or a filesystem path. */
  kind: "url" | "file";
  /** The matched text. For URLs, this is the full URL. For files, the path. */
  text: string;
  /** Zero-based row index in the grid. */
  row: number;
  /** First column of the match (inclusive). */
  col_start: number;
  /** One past the last column of the match (exclusive). */
  col_end: number;
}

// ─── Regular expressions ──────────────────────────────────────────────────────

/**
 * Matches http, https, ftp, and file URLs.
 *
 * Stops at whitespace, quotes, angle brackets, and common terminal
 * punctuation that would not be part of a URL.
 */
const URL_REGEX = /(?:https?|ftp|file):\/\/[^\s"'<>()[\]{}\\]+/g;

/**
 * Matches absolute and relative file paths ending in a known extension or
 * starting with /. Covers common source and config file extensions.
 *
 * Matches:
 *   - /absolute/path/to/file.ext
 *   - ./relative/path.ext
 *   - ../parent/path.rs
 */
const FILE_PATH_REGEX =
  /(?:\/|\.\.?\/)[^\s"'<>()[\]{}\\]*\.(?:ts|tsx|js|jsx|svelte|rs|md|json|toml|yaml|yml|sh|bash|zsh|fish|py|rb|go|c|cpp|h|hpp|css|html|txt|log|lock)/g;

// ─── extractLinks ─────────────────────────────────────────────────────────────

/**
 * Scan all rows of `grid` for URLs and file paths.
 *
 * Each row is converted to a string by joining cell characters. Regex
 * matches are recorded with their grid coordinates.
 *
 * @param grid - The grid snapshot to scan. May have zero rows.
 * @returns Array of `LinkMatch` objects, ordered by row then col_start.
 */
export function extractLinks(grid: GridSnapshot): LinkMatch[] {
  const results: LinkMatch[] = [];

  for (let rowIdx = 0; rowIdx < grid.rows_data.length; rowIdx++) {
    const rowData = grid.rows_data[rowIdx];
    if (!rowData) continue;

    // Reconstruct the row text by joining all cell characters.
    const rowText = rowData.cells.map((c) => c.ch).join("");

    // --- URL matches ---
    URL_REGEX.lastIndex = 0;
    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = URL_REGEX.exec(rowText)) !== null) {
      const text = trimTrailingPunct(urlMatch[0]);
      if (text.length === 0) continue;
      results.push({
        kind: "url",
        text,
        row: rowIdx,
        col_start: urlMatch.index,
        col_end: urlMatch.index + text.length,
      });
    }

    // --- File path matches ---
    FILE_PATH_REGEX.lastIndex = 0;
    let fileMatch: RegExpExecArray | null;
    while ((fileMatch = FILE_PATH_REGEX.exec(rowText)) !== null) {
      const text = trimTrailingPunct(fileMatch[0]);
      if (text.length === 0) continue;
      results.push({
        kind: "file",
        text,
        row: rowIdx,
        col_start: fileMatch.index,
        col_end: fileMatch.index + text.length,
      });
    }
  }

  // Sort by row, then col_start for deterministic ordering.
  results.sort((a, b) => a.row - b.row || a.col_start - b.col_start);
  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip trailing punctuation characters that commonly follow a URL in
 * terminal output (periods, commas, colons, semicolons, closing brackets).
 *
 * For example: `"See https://example.com."` → `"https://example.com"`.
 */
function trimTrailingPunct(s: string): string {
  return s.replace(/[.,;:!?)}\]]+$/, "");
}
