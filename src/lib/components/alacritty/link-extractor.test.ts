/**
 * link-extractor.test.ts — cycle-18, AC-3
 *
 * Tests for extractLinks() operating on GridSnapshot data.
 * Test names contain "link" or "extract" to satisfy the verify-envelope gate.
 */

import { describe, it, expect } from "vitest";
import { extractLinks } from "./link-extractor";
import type { GridSnapshot, Cell } from "../../types/terminal-ipc";

// ─── Grid seeding helpers ─────────────────────────────────────────────────────

/** Build a single Cell with default colors and no attrs. */
function makeCell(ch: string): Cell {
  return {
    ch,
    fg: { kind: "Indexed", value: 7 },
    bg: { kind: "Indexed", value: 0 },
    attrs: 0,
  };
}

/** Build a GridSnapshot row from a string, padded to `cols` with spaces. */
function makeRow(text: string, cols: number) {
  const cells: Cell[] = [];
  for (let i = 0; i < cols; i++) {
    cells.push(makeCell(i < text.length ? text[i]! : " "));
  }
  return { cells };
}

/**
 * Build a minimal GridSnapshot with one or more rows of text.
 * All rows are padded to the same `cols` width.
 */
function makeGrid(rows: string[], cols = 80): GridSnapshot {
  return {
    cols,
    rows: rows.length,
    cursor: { row: 0, col: 0, visible: false, shape: { kind: "hidden" } },
    rows_data: rows.map((text) => makeRow(text, cols)),
  };
}

// ─── URL extraction tests ─────────────────────────────────────────────────────

describe("extractLinks — URL detection", () => {
  it("extract_url_finds_http_in_seeded_grid", () => {
    const grid = makeGrid(["Visit http://example.com for info"]);
    const links = extractLinks(grid);

    const urlLink = links.find((l) => l.text === "http://example.com");
    expect(urlLink).toBeDefined();
    expect(urlLink?.kind).toBe("url");
    expect(urlLink?.row).toBe(0);
  });

  it("extract_link_finds_https_url_in_grid", () => {
    const grid = makeGrid(["See https://github.com/org/repo"]);
    const links = extractLinks(grid);

    const urlLink = links.find((l) => l.text.startsWith("https://github.com"));
    expect(urlLink).toBeDefined();
    expect(urlLink?.kind).toBe("url");
  });

  it("extract_link_finds_multiple_urls_in_same_row", () => {
    const grid = makeGrid([
      "http://first.com and https://second.com both here",
    ]);
    const links = extractLinks(grid);

    const urls = links.filter((l) => l.kind === "url");
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls.some((l) => l.text === "http://first.com")).toBe(true);
    expect(urls.some((l) => l.text === "https://second.com")).toBe(true);
  });

  it("extract_link_finds_url_in_second_row", () => {
    const grid = makeGrid(["first row", "http://second-row.org/path"]);
    const links = extractLinks(grid);

    const urlLink = links.find((l) =>
      l.text.startsWith("http://second-row.org"),
    );
    expect(urlLink).toBeDefined();
    expect(urlLink?.row).toBe(1);
  });

  it("extract_link_returns_correct_col_start_for_url", () => {
    // "Visit " is 6 chars, then the URL starts
    const grid = makeGrid(["Visit http://example.com done"]);
    const links = extractLinks(grid);

    const urlLink = links.find((l) => l.text === "http://example.com");
    expect(urlLink?.col_start).toBe(6);
    expect(urlLink?.col_end).toBe(6 + "http://example.com".length);
  });

  it("extract_link_finds_no_links_in_plain_text", () => {
    const grid = makeGrid(["Just some plain text with no links here"]);
    const links = extractLinks(grid);
    expect(links.length).toBe(0);
  });

  it("extract_link_finds_ftp_url", () => {
    const grid = makeGrid(["Download from ftp://files.example.com/file.zip"]);
    const links = extractLinks(grid);

    const ftpLink = links.find((l) => l.text.startsWith("ftp://"));
    expect(ftpLink).toBeDefined();
    expect(ftpLink?.kind).toBe("url");
  });
});

// ─── File path extraction tests ───────────────────────────────────────────────

describe("extractLinks — file path detection", () => {
  it("extract_link_finds_absolute_unix_path_ts_file", () => {
    const grid = makeGrid(["Error in /home/user/project/src/main.ts:10:5"]);
    const links = extractLinks(grid);

    const filePath = links.find((l) => l.kind === "file");
    expect(filePath).toBeDefined();
    expect(filePath?.text).toContain("/home/user/project/src/main.ts");
  });

  it("extract_link_finds_relative_path_with_extension", () => {
    const grid = makeGrid(["see ./src/components/App.svelte for details"]);
    const links = extractLinks(grid);

    const filePath = links.find(
      (l) => l.kind === "file" && l.text.endsWith(".svelte"),
    );
    expect(filePath).toBeDefined();
  });

  it("extract_link_col_bounds_correct_for_file_path", () => {
    const prefix = "open ";
    const path = "/usr/local/src/main.ts";
    const grid = makeGrid([`${prefix}${path}`]);
    const links = extractLinks(grid);

    const fileLink = links.find((l) => l.kind === "file" && l.text === path);
    expect(fileLink?.col_start).toBe(prefix.length);
  });
});

// ─── Empty grid tests ─────────────────────────────────────────────────────────

describe("extractLinks — edge cases", () => {
  it("extract_link_returns_empty_for_empty_grid", () => {
    const grid = makeGrid([]);
    const links = extractLinks(grid);
    expect(links).toEqual([]);
  });

  it("extract_link_returns_empty_for_blank_row", () => {
    const grid = makeGrid(["     "]);
    const links = extractLinks(grid);
    expect(links).toEqual([]);
  });
});
