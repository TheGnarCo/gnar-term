# Cycle 16 — AC-1 search parity: Rust regex_search + TS SearchBridge

## Envelope

```yaml
run_id: 2026-05-16-alacritty-terminal-engine
cycle_id: cycle-16
cycle_branch: run/2026-05-16-alacritty-terminal-engine/cycle-16
parent_sha: f460687184b2d100c7705df703678d69a3ea511e
acs_covered: [AC-1]
ac_test_evidence:
  AC-1: regex_search_finds_case_sensitive_literal
        regex_search_finds_case_insensitive_literal
        regex_search_case_sensitive_no_match_on_wrong_case
        regex_search_whole_word_matches_isolated_word
        regex_search_whole_word_no_match_for_substring
        regex_search_regex_mode_matches_pattern
        regex_search_escapes_regex_metacharacters_in_literal_mode
        regex_search_find_next_returns_none_when_no_match
        regex_search_find_prev_locates_match_searching_backwards
        regex_search_find_prev_returns_none_when_no_match
tests_passing: 59 Rust (terminal_engine), 2266 TypeScript
tests_failing: 0
deviations:
  - Added `pub mod search;` to `src-tauri/src/terminal_engine/mod.rs`
    (plan said cycle-21 owns this file). Necessary for `cargo test` to
    reach the module. cycle-21 should treat this as already done.
  - Created stub `dist/index.html` in the cycle worktree so that
    `tauri::generate_context!()` macro can compile (the proc-macro checks
    for the `frontendDist` directory at compile time). This file is not
    committed; it exists only in the worktree's working tree.
  - Tests are inline in `search.rs` (not a separate `search_tests.rs`)
    because `#[cfg(test)] mod search_tests;` inside a module file requires
    the sub-file to live in a search/ subdirectory, which conflicts with
    the sibling-file convention. The `search_tests.rs` file in the
    allowed-files list is present but empty; tests live in `search.rs`.
```

## What was built

### Rust — `src-tauri/src/terminal_engine/search.rs`

A new module that wraps `alacritty_terminal::term::search::RegexSearch` and
`Term::regex_search_left` / `Term::regex_search_right` behind a serde-friendly
surface.

**`SearchQuery` struct** (camelCase serde):
- `pattern: String` — the search text
- `case_sensitive: bool` — when false, `(?i)` prefix is applied
- `whole_word: bool` — when true, `(?-u:\b)` ASCII word boundaries are wrapped
- `regex: bool` — when false, metacharacters are escaped (literal mode)

**`SearchMatch` struct** (camelCase serde):
- `start_row / start_col / end_row / end_col` — inclusive endpoints mirroring
  alacritty's `RangeInclusive<Point>`

**`find_next(term, query, start) -> Result<Option<SearchMatch>, String>`**:
Calls `Term::regex_search_right` from `start` to the bottom-right corner.

**`find_prev(term, query, start) -> Result<Option<SearchMatch>, String>`**:
Calls `Term::regex_search_left` from `start` to the top-left corner.

**`clear()`**: no-op; mirrors `clearDecorations` from xterm's SearchAddon.

**Three Tauri command stubs** (`search_find_next`, `search_find_prev`,
`search_clear`) — synchronous, annotated `#[tauri::command]`, return stub
errors until cycle-21 wires them to `AppState`.

### Key implementation findings

**Case sensitivity**: `RegexSearch::new` uses `has_uppercase` to auto-detect
case. For all-lowercase patterns with `case_sensitive=true`, this would
silently enable case-insensitive matching. Fix: prepend `(?-i)` for
case-sensitive mode and `(?i)` for case-insensitive.

**Word boundaries**: `\b` (Unicode word boundaries) is rejected by
`regex_automata`'s lazy DFA backend with:
```
cannot build lazy DFAs for regexes with Unicode word boundaries
```
Fix: use `(?-u:\b)` which selects ASCII word boundaries. This covers all
common terminal search use cases (ASCII identifiers, shell commands, etc.).

### TypeScript — `src/lib/components/alacritty/search-bridge.ts`

New module in `src/lib/components/alacritty/` (new directory, first Wave-A
module).

**`SearchQuery` and `SearchMatch` interfaces**: mirror the Rust serde shapes
exactly (camelCase).

**`attachSearch(paneId: string): SearchHandle`**: factory that returns a
`SearchHandle` bound to the given pane. The pane ID is threaded through to
each `invoke` call so cycle-21's Rust handler can look up the engine from
`AppState`.

**`SearchHandle` interface**:
- `findNext(query): Promise<SearchMatch | null>` — invokes `search_find_next`
- `findPrev(query): Promise<SearchMatch | null>` — invokes `search_find_prev`
- `clear(): Promise<void>` — invokes `search_clear`

## What cycle-21 must do

1. **`mod.rs`**: `pub mod search;` is already present (added in this cycle
   as a deviation). No change needed.
2. **`src-tauri/src/lib.rs`**: Add to `tauri::generate_handler!`:
   ```rust
   terminal_engine::search::search_find_next,
   terminal_engine::search::search_find_prev,
   terminal_engine::search::search_clear,
   ```
3. **Full command wiring**: Replace the stub bodies in `search_find_next` /
   `search_find_prev` with AppState lookup + `find_next` / `find_prev` calls.
   The `pane_id` parameter needs to be added to the command signatures.
4. **FindBar.svelte**: Import `attachSearch` from
   `./alacritty/search-bridge.ts` and swap `searchAddon.findNext/findPrev/
   clearDecorations` for `handle.findNext/findPrev/clear`.

## Ontology terms proposed

- `SearchQuery` — search parameters (pattern + toggles)
- `SearchMatch` — inclusive grid range result
- `SearchBridge` / `SearchHandle` — the per-pane search lifecycle object

## Future work (out of scope)

- Cursor-position threading: `findNext`/`findPrev` currently hard-code the
  start at origin / bottom-right. cycle-21 should thread the actual viewport
  cursor position from `AlacrittyTerminalSurface.svelte` as `startRow/startCol`.
- Result highlighting: the canvas renderer does not yet draw highlight boxes
  around matches. This is a cycle-21+ rendering task.
- Scrollback search: `find_next` / `find_prev` currently search only the
  visible viewport rows. Extending to scrollback requires passing the
  topmost-line offset into the end/start points.
