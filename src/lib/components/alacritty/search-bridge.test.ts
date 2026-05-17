/**
 * search-bridge.test.ts — vitest tests for the alacritty SearchBridge module.
 *
 * AC-1 keyword: regex_search (required by verify-envelope.sh)
 *
 * All tests mock `@tauri-apps/api/core`'s `invoke` so they run without a
 * real Tauri runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { attachSearch } from "./search-bridge";
import type { SearchQuery, SearchMatch } from "./search-bridge";

// ─── Mock setup ───────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Import the mocked module so we can control return values per test.
import { invoke } from "@tauri-apps/api/core";
const mockInvoke = invoke as Mock;

beforeEach(() => {
  mockInvoke.mockReset();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PANE_ID = "test-pane-abc";

function literalQuery(pattern: string): SearchQuery {
  return { pattern, caseSensitive: true, wholeWord: false, regex: false };
}

function ciQuery(pattern: string): SearchQuery {
  return { pattern, caseSensitive: false, wholeWord: false, regex: false };
}

function regexQuery(pattern: string): SearchQuery {
  return { pattern, caseSensitive: true, wholeWord: false, regex: true };
}

const MATCH: SearchMatch = {
  startRow: 0,
  startCol: 6,
  endRow: 0,
  endCol: 10,
};

// ─── attachSearch ─────────────────────────────────────────────────────────────

describe("attachSearch", () => {
  it("returns a SearchHandle with findNext, findPrev, and clear methods", () => {
    const handle = attachSearch(PANE_ID);
    expect(typeof handle.findNext).toBe("function");
    expect(typeof handle.findPrev).toBe("function");
    expect(typeof handle.clear).toBe("function");
  });
});

// ─── findNext ─────────────────────────────────────────────────────────────────

describe("SearchHandle.findNext", () => {
  /**
   * AC-1: regex_search findNext invokes the correct Tauri command.
   */
  it("regex_search findNext invokes search_find_next with the query and pane id", async () => {
    mockInvoke.mockResolvedValueOnce(MATCH);
    const handle = attachSearch(PANE_ID);
    const q = literalQuery("World");
    const result = await handle.findNext(q);
    expect(mockInvoke).toHaveBeenCalledWith("search_find_next", {
      paneId: PANE_ID,
      query: q,
      startRow: 0,
      startCol: 0,
    });
    expect(result).toEqual(MATCH);
  });

  /**
   * AC-1: regex_search findNext returns null when invoke resolves to null.
   */
  it("regex_search findNext returns null when no match is found", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const handle = attachSearch(PANE_ID);
    const result = await handle.findNext(literalQuery("zzz"));
    expect(result).toBeNull();
  });

  /**
   * AC-1: regex_search findNext forwards case-insensitive query flag.
   */
  it("regex_search findNext forwards case-insensitive flag in query", async () => {
    mockInvoke.mockResolvedValueOnce(MATCH);
    const handle = attachSearch(PANE_ID);
    const q = ciQuery("world");
    await handle.findNext(q);
    expect(mockInvoke).toHaveBeenCalledWith(
      "search_find_next",
      expect.objectContaining({ query: q }),
    );
  });

  /**
   * AC-1: regex_search findNext forwards regex mode query.
   */
  it("regex_search findNext forwards regex mode query flag", async () => {
    mockInvoke.mockResolvedValueOnce(MATCH);
    const handle = attachSearch(PANE_ID);
    const q = regexQuery("[0-9]+");
    await handle.findNext(q);
    expect(mockInvoke).toHaveBeenCalledWith(
      "search_find_next",
      expect.objectContaining({ query: q }),
    );
  });
});

// ─── findPrev ─────────────────────────────────────────────────────────────────

describe("SearchHandle.findPrev", () => {
  /**
   * AC-1: regex_search findPrev invokes the correct Tauri command.
   */
  it("regex_search findPrev invokes search_find_prev with the query and pane id", async () => {
    mockInvoke.mockResolvedValueOnce(MATCH);
    const handle = attachSearch(PANE_ID);
    const q = literalQuery("Hello");
    const result = await handle.findPrev(q);
    expect(mockInvoke).toHaveBeenCalledWith("search_find_prev", {
      paneId: PANE_ID,
      query: q,
      startRow: 9999,
      startCol: 9999,
    });
    expect(result).toEqual(MATCH);
  });

  /**
   * AC-1: regex_search findPrev returns null when no prior match exists.
   */
  it("regex_search findPrev returns null when no match is found", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const handle = attachSearch(PANE_ID);
    const result = await handle.findPrev(literalQuery("zzz"));
    expect(result).toBeNull();
  });
});

// ─── clear ────────────────────────────────────────────────────────────────────

describe("SearchHandle.clear", () => {
  /**
   * AC-1: regex_search clear invokes search_clear with the pane id.
   */
  it("regex_search clear invokes search_clear and resolves", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const handle = attachSearch(PANE_ID);
    await expect(handle.clear()).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledWith("search_clear", {
      paneId: PANE_ID,
    });
  });
});
