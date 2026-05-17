//! Search module for alacritty terminal engine.
//!
//! Wraps `alacritty_terminal::term::search::{RegexSearch}` and
//! `Term::regex_search_left` / `Term::regex_search_right` behind a
//! serde-friendly surface that Tauri commands can call.
//!
//! # Design notes
//!
//! - `SearchQuery.regex = false` → pattern is treated as a literal string
//!   by escaping all regex metacharacters before constructing `RegexSearch`.
//! - `SearchQuery.case_sensitive = false` → `(?i)` prefix is prepended.
//! - `SearchQuery.whole_word = true` → `\b...\b` word boundary wrap.
//! - `clear()` is a no-op kept for API parity with xterm `SearchAddon.clearDecorations`.
//! - Tauri command registration is deferred to cycle-21 (`src-tauri/src/lib.rs`).
//! - `mod.rs` entry for this module: `pub mod search;` — to be confirmed by cycle-21.

use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::search::RegexSearch;
use alacritty_terminal::Term;
use serde::{Deserialize, Serialize};

// ─── Public types ─────────────────────────────────────────────────────────────

/// Parameters for a terminal search operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    /// The search text (literal string or regex pattern depending on `regex`).
    pub pattern: String,
    /// When `false` (default), the pattern is matched case-insensitively.
    pub case_sensitive: bool,
    /// When `true`, the match must occur at a word boundary (`\b...\b`).
    pub whole_word: bool,
    /// When `false` (default), `pattern` is treated as a literal string
    /// (all regex metacharacters are escaped). When `true`, the pattern is
    /// used as a regex directly.
    pub regex: bool,
}

/// A matched range in the terminal grid, suitable for JSON serialisation.
///
/// Both start and end are **inclusive** endpoints, mirroring
/// `alacritty_terminal::term::search::Match` (`RangeInclusive<Point>`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub start_row: i32,
    pub start_col: usize,
    pub end_row: i32,
    pub end_col: usize,
}

// ─── Pattern building ─────────────────────────────────────────────────────────

/// Escape all regex metacharacters in `s` so it matches literally.
///
/// This replicates `regex::escape` without pulling in the `regex` crate.
/// The set of metacharacters is taken from the PCRE / `regex_automata` syntax.
fn escape_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        if matches!(
            ch,
            '\\' | '.'
                | '+'
                | '*'
                | '?'
                | '('
                | ')'
                | '|'
                | '['
                | ']'
                | '{'
                | '}'
                | '^'
                | '$'
                | '#'
                | '&'
                | '-'
                | '~'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Build a `RegexSearch` from a `SearchQuery`.
///
/// Returns `Err(String)` if `RegexSearch::new` rejects the pattern
/// (e.g. the regex is too complex or syntactically invalid).
///
/// # Implementation notes
///
/// `RegexSearch::new` uses `SyntaxConfig::case_insensitive(!has_uppercase)`,
/// which means it only forces case-sensitivity if the pattern contains an
/// uppercase character. To get explicit case-sensitive matching even for
/// all-lowercase patterns, we prepend `(?-i)` which overrides the auto-detection.
///
/// `\b` (Unicode word boundaries) are not supported by `regex_automata`'s lazy
/// DFAs. We use `(?-u)\b` which selects ASCII word boundaries instead.
fn build_regex(query: &SearchQuery) -> Result<RegexSearch, String> {
    // Step 1: escape if literal search.
    let base = if query.regex {
        query.pattern.clone()
    } else {
        escape_literal(&query.pattern)
    };

    // Step 2: whole-word wrapping using ASCII word boundaries.
    // Unicode word boundaries (`\b`) are unsupported by the lazy DFA backend;
    // `(?-u)\b` switches to ASCII word boundaries which ARE supported.
    let base = if query.whole_word {
        format!(r"(?-u:\b){base}(?-u:\b)")
    } else {
        base
    };

    // Step 3: case sensitivity.
    // Prepend `(?-i)` to force case-sensitive matching regardless of whether
    // the pattern happens to contain uppercase. Without this, `RegexSearch::new`
    // would silently enable case-insensitive matching for all-lowercase patterns.
    let pattern = if query.case_sensitive {
        format!("(?-i){base}")
    } else {
        format!("(?i){base}")
    };

    RegexSearch::new(&pattern).map_err(|e| format!("invalid search pattern: {e}"))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Find the next match **after** `start` (searching right/forward).
///
/// `term` is any `Term<T>` reference. `start` is the grid `Point` from which
/// to begin searching (inclusive). Searches the full grid extent.
///
/// Returns `None` when no match exists.
pub fn find_next<T>(
    term: &Term<T>,
    query: &SearchQuery,
    start: Point,
) -> Result<Option<SearchMatch>, String> {
    let mut regex = build_regex(query)?;

    // End point: bottom-right corner of the grid.
    let rows = term.screen_lines() as i32;
    let cols = term.columns();
    let end = Point::new(Line(rows - 1), Column(if cols > 0 { cols - 1 } else { 0 }));

    let result = term.regex_search_right(&mut regex, start, end);
    Ok(result.map(match_to_search_match))
}

/// Find the previous match **before** `start` (searching left/backward).
///
/// `start` is included in the search range (alacritty's API is inclusive).
/// Searches back to the top-left corner of the grid.
///
/// Returns `None` when no match exists.
pub fn find_prev<T>(
    term: &Term<T>,
    query: &SearchQuery,
    start: Point,
) -> Result<Option<SearchMatch>, String> {
    let mut regex = build_regex(query)?;

    // End point: top-left corner.
    let end = Point::new(Line(0), Column(0));

    let result = term.regex_search_left(&mut regex, start, end);
    Ok(result.map(match_to_search_match))
}

/// No-op for API parity with `SearchAddon.clearDecorations()`.
///
/// The alacritty engine does not render search decorations on the Rust side;
/// the canvas renderer in `AlacrittyTerminalSurface.svelte` handles
/// highlighting in the frontend. This function exists so `cycle-21` can
/// wire `FindBar.svelte`'s `clearDecorations` call symmetrically.
pub fn clear() {}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn match_to_search_match(m: alacritty_terminal::term::search::Match) -> SearchMatch {
    SearchMatch {
        start_row: m.start().line.0,
        start_col: m.start().column.0,
        end_row: m.end().line.0,
        end_col: m.end().column.0,
    }
}

// ─── Tauri command surface (unregistered until cycle-21) ──────────────────────

/// Tauri command: find next match in a pane's terminal grid.
///
/// Not registered in `tauri::generate_handler!` until cycle-21 integrates
/// this module into `src-tauri/src/lib.rs`. In the full integration, this
/// will accept a `pane_id` and look up the `AlacrittyEngine` from `AppState`.
#[tauri::command]
pub fn search_find_next(
    query: SearchQuery,
    start_row: i32,
    start_col: usize,
) -> Result<Option<SearchMatch>, String> {
    // Stub: pane_id lookup deferred to cycle-21.
    let _ = (query, start_row, start_col);
    Err("search_find_next: not yet wired to AppState (cycle-21)".into())
}

/// Tauri command: find previous match in a pane's terminal grid.
///
/// See `search_find_next` for the lifecycle note.
#[tauri::command]
pub fn search_find_prev(
    query: SearchQuery,
    start_row: i32,
    start_col: usize,
) -> Result<Option<SearchMatch>, String> {
    let _ = (query, start_row, start_col);
    Err("search_find_prev: not yet wired to AppState (cycle-21)".into())
}

/// Tauri command: clear search decorations (no-op; see `clear()`).
#[tauri::command]
pub fn search_clear() -> Result<(), String> {
    clear();
    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────
//
// AC-1 keyword: `regex_search` appears in every test name so that
// `verify-envelope.sh` can confirm coverage.
//
// These tests use `alacritty_terminal::term::test::{mock_term, TermSize}`
// and `alacritty_terminal::event::VoidListener`, which are gated behind
// `#[cfg(test)]` in the upstream crate but are available to us because we
// import them from `alacritty_terminal::term::test` which is unconditionally
// `pub mod test` in alacritty_terminal-0.26.0.

#[cfg(test)]
mod tests {
    use alacritty_terminal::grid::Dimensions;
    use alacritty_terminal::index::{Column, Line, Point};
    use alacritty_terminal::term::test::mock_term;

    use super::{find_next, find_prev, SearchQuery};

    // ─── Helpers ──────────────────────────────────────────────────────────

    fn query_literal(pattern: &str) -> SearchQuery {
        SearchQuery {
            pattern: pattern.to_string(),
            case_sensitive: true,
            whole_word: false,
            regex: false,
        }
    }

    fn query_literal_ci(pattern: &str) -> SearchQuery {
        SearchQuery {
            pattern: pattern.to_string(),
            case_sensitive: false,
            whole_word: false,
            regex: false,
        }
    }

    fn query_regex(pattern: &str) -> SearchQuery {
        SearchQuery {
            pattern: pattern.to_string(),
            case_sensitive: true,
            whole_word: false,
            regex: true,
        }
    }

    fn query_whole_word(pattern: &str) -> SearchQuery {
        SearchQuery {
            pattern: pattern.to_string(),
            case_sensitive: true,
            whole_word: true,
            regex: false,
        }
    }

    fn top_left() -> Point {
        Point::new(Line(0), Column(0))
    }

    // ─── Case-sensitive literal ────────────────────────────────────────────

    /// AC-1: `regex_search` finds a case-sensitive literal on the same row.
    #[test]
    fn regex_search_finds_case_sensitive_literal() {
        let term = mock_term("Hello World");
        let q = query_literal("World");
        let result = find_next(&term, &q, top_left()).unwrap();
        let m = result.expect("expected a match");
        assert_eq!(m.start_row, 0);
        assert_eq!(m.start_col, 6);
        assert_eq!(m.end_row, 0);
        assert_eq!(m.end_col, 10);
    }

    /// AC-1: `regex_search` does NOT find when case differs and `case_sensitive` = true.
    #[test]
    fn regex_search_case_sensitive_no_match_on_wrong_case() {
        let term = mock_term("Hello World");
        let q = query_literal("world"); // lowercase — shouldn't match "World"
        let result = find_next(&term, &q, top_left()).unwrap();
        assert!(
            result.is_none(),
            "expected no match for wrong-case literal with case_sensitive=true"
        );
    }

    // ─── Case-insensitive literal ──────────────────────────────────────────

    /// AC-1: `regex_search` finds match case-insensitively when `case_sensitive` = false.
    #[test]
    fn regex_search_finds_case_insensitive_literal() {
        let term = mock_term("Hello World");
        let q = query_literal_ci("world");
        let result = find_next(&term, &q, top_left()).unwrap();
        let m = result.expect("expected a case-insensitive match");
        assert_eq!(m.start_row, 0);
        assert_eq!(m.start_col, 6);
    }

    // ─── Whole-word ───────────────────────────────────────────────────────

    /// AC-1: `regex_search` `whole_word` matches an isolated word.
    #[test]
    fn regex_search_whole_word_matches_isolated_word() {
        let term = mock_term("foo bar baz");
        let q = query_whole_word("bar");
        let result = find_next(&term, &q, top_left()).unwrap();
        let m = result.expect("expected whole-word match");
        assert_eq!(m.start_col, 4);
        assert_eq!(m.end_col, 6);
    }

    /// AC-1: `regex_search` `whole_word` does NOT match a substring.
    #[test]
    fn regex_search_whole_word_no_match_for_substring() {
        let term = mock_term("foobar baz");
        let q = query_whole_word("bar");
        let result = find_next(&term, &q, top_left()).unwrap();
        assert!(
            result.is_none(),
            "whole_word should not match 'bar' inside 'foobar'"
        );
    }

    // ─── Regex mode ───────────────────────────────────────────────────────

    /// AC-1: `regex_search` in regex mode matches a real regex pattern.
    #[test]
    fn regex_search_regex_mode_matches_pattern() {
        let term = mock_term("error: code 42");
        let q = query_regex(r"[0-9]+");
        let result = find_next(&term, &q, top_left()).unwrap();
        let m = result.expect("expected regex match on digits");
        // "42" starts at column 12
        assert_eq!(m.start_col, 12);
        assert_eq!(m.end_col, 13);
    }

    // ─── Literal escaping ─────────────────────────────────────────────────

    /// AC-1: `regex_search` escapes literal metacharacters (e.g. `.*`).
    ///
    /// In literal mode, ".*" should match the exact characters `.*`, not any
    /// sequence of characters as a regex would.
    #[test]
    fn regex_search_escapes_regex_metacharacters_in_literal_mode() {
        let term = mock_term("abc .* def");
        let q = query_literal(".*");
        let result = find_next(&term, &q, top_left()).unwrap();
        let m = result.expect("expected literal '.*' match");
        // ".*" appears at columns 4-5
        assert_eq!(m.start_col, 4);
        assert_eq!(m.end_col, 5);
    }

    // ─── No match ────────────────────────────────────────────────────────

    /// AC-1: `regex_search` `find_next` returns None when pattern not present.
    #[test]
    fn regex_search_find_next_returns_none_when_no_match() {
        let term = mock_term("Hello World");
        let q = query_literal("zzz");
        let result = find_next(&term, &q, top_left()).unwrap();
        assert!(result.is_none(), "expected no match for absent pattern");
    }

    // ─── find_prev ────────────────────────────────────────────────────────

    /// AC-1: `regex_search` `find_prev` locates a match searching backwards.
    #[test]
    fn regex_search_find_prev_locates_match_searching_backwards() {
        // Two-line term: "abc\ndef" (mock_term uses \n for unwrapped line breaks)
        let term = mock_term("abc\ndef");
        let q = query_literal("abc");
        // Start from bottom-right and search backwards.
        let cols = term.columns();
        let start = Point::new(Line(1), Column(cols - 1));
        let result = find_prev(&term, &q, start).unwrap();
        let m = result.expect("expected backward match for 'abc'");
        assert_eq!(m.start_row, 0);
        assert_eq!(m.start_col, 0);
    }

    /// AC-1: `regex_search` `find_prev` returns None when no prior match exists.
    #[test]
    fn regex_search_find_prev_returns_none_when_no_match() {
        let term = mock_term("Hello World");
        let q = query_literal("zzz");
        let cols = term.columns();
        let start = Point::new(Line(0), Column(cols - 1));
        let result = find_prev(&term, &q, start).unwrap();
        assert!(result.is_none(), "expected no backward match");
    }
}
