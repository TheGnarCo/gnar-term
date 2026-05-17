/**
 * search-bridge.ts — TypeScript bridge to the alacritty search Tauri commands.
 *
 * Provides a `SearchHandle` that mirrors the interface of xterm's `SearchAddon`
 * (`findNext` / `findPrev` / `clear`) so `FindBar.svelte` can be rewired to
 * this surface in cycle-21 without changing its call sites.
 *
 * The Rust commands (`search_find_next`, `search_find_prev`, `search_clear`)
 * are registered in `src-tauri/src/lib.rs` by cycle-21. Until then, calling
 * these methods will reject with a "not yet wired to AppState" error — this is
 * expected during development and can be guarded with a try/catch.
 *
 * Ontology note: `SearchBridge` is the module concept; `SearchHandle` is the
 * per-pane instance returned by `attachSearch`.
 */

import { invoke } from "@tauri-apps/api/core";

// ─── Serde-mirrored types (must match Rust search.rs) ────────────────────────

/**
 * Parameters for a terminal search operation.
 *
 * Mirrors the Rust `SearchQuery` struct (camelCase ↔ snake_case via serde).
 */
export interface SearchQuery {
  /** The search text (literal string or regex pattern). */
  pattern: string;
  /** When `false` (default), the match is case-insensitive. */
  caseSensitive: boolean;
  /** When `true`, the match must occur at a word boundary. */
  wholeWord: boolean;
  /**
   * When `false` (default), `pattern` is treated as a literal string
   * (metacharacters are escaped on the Rust side). When `true`, the
   * pattern is used as a regex directly.
   */
  regex: boolean;
}

/**
 * A matched range in the terminal grid.
 *
 * Mirrors the Rust `SearchMatch` struct. Both endpoints are **inclusive**.
 */
export interface SearchMatch {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// ─── SearchHandle ─────────────────────────────────────────────────────────────

/**
 * Per-pane search handle returned by `attachSearch`.
 *
 * The `paneId` is threaded through to each Tauri command so the Rust side can
 * look up the correct `AlacrittyEngine` from `AppState` (cycle-21 wires this).
 */
export interface SearchHandle {
  /**
   * Find the next match after the cursor position (searching forward).
   *
   * @param query  Search parameters (pattern, toggles).
   * @returns      The first match, or `null` if none was found.
   */
  findNext(query: SearchQuery): Promise<SearchMatch | null>;

  /**
   * Find the previous match before the cursor position (searching backward).
   *
   * @param query  Search parameters (pattern, toggles).
   * @returns      The closest prior match, or `null` if none was found.
   */
  findPrev(query: SearchQuery): Promise<SearchMatch | null>;

  /**
   * Clear search state / decorations.
   *
   * No-op on the Rust side (decorations are managed in the canvas renderer);
   * exists for API parity with `SearchAddon.clearDecorations`.
   */
  clear(): Promise<void>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a `SearchHandle` bound to the given pane.
 *
 * `paneId` is passed through to the Tauri commands so the Rust layer can
 * resolve the correct terminal engine. The search position defaults to the
 * origin (row 0, col 0) for `findNext` and to the bottom-right corner for
 * `findPrev`; cycle-21 may extend this to accept an explicit cursor position
 * from `AlacrittyTerminalSurface.svelte`.
 *
 * @param paneId  The pane identifier as used by the rest of the Tauri IPC.
 */
export function attachSearch(paneId: string): SearchHandle {
  return {
    async findNext(query: SearchQuery): Promise<SearchMatch | null> {
      const result = await invoke<SearchMatch | null>("search_find_next", {
        paneId,
        query,
        startRow: 0,
        startCol: 0,
      });
      return result ?? null;
    },

    async findPrev(query: SearchQuery): Promise<SearchMatch | null> {
      const result = await invoke<SearchMatch | null>("search_find_prev", {
        paneId,
        query,
        // Default start for backward search: a large row/col so the search
        // effectively starts at the end of the viewport. cycle-21 will thread
        // the actual cursor position from the renderer.
        startRow: 9999,
        startCol: 9999,
      });
      return result ?? null;
    },

    async clear(): Promise<void> {
      await invoke("search_clear", { paneId });
    },
  };
}
