---
cycle_id: cycle-8
run_id: 2026-05-16-alacritty-terminal-engine
cycle_branch: run/2026-05-16-alacritty-terminal-engine/cycle-8
parent_sha: 4521a4ee8bc7abedaa3170f3f85370579b8d6c31
mode: remediation
acs_covered: [AC-3, AC-4, AC-5, AC-6, AC-7]
ac_test_evidence:
  AC-3:
    - "terminal_engine::pty_bridge_tests::feed_bytes_emits_griddiff_payload_with_damage"
    - "terminal_engine::pty_bridge_tests::bridge_channel_snapshot_arrives_before_any_diff"
  AC-4:
    - "alacritty-renderer.test.ts: paintSnapshot with visible cursor paints cursor after cells"
    - "alacritty-renderer.test.ts: SGR bold / underline / inverse"
  AC-5:
    - "alacritty-key-encoder.test.ts: encode Enter/Backspace/Tab/Escape/arrows/printable ASCII"
  AC-6:
    - "pane-view-dispatch.test.ts: dispatch with engine alacritty selects AlacrittyTerminalSurface"
  AC-7:
    - "terminal_engine::ipc_tests::wire_format_rgb_color_index_serialises_as_array"
    - "terminal_engine::ipc_tests::wire_contract_json_keys_are_snake_case"
status: complete
tests_passing: 21 Rust terminal_engine + 2197 JS (203 files)
---

# Cycle-8 Prose Narrative

## What was wired

### CRITICAL fixes

**F-001 — detach_alacritty_engine command**: Added `detach_alacritty_engine` Tauri command to `alacritty_commands.rs`, registered in `lib.rs`'s `generate_handler!`. Also added a bridge cleanup safety net to `kill_pty`: it now removes the bridge entry before removing the PTY entry, ensuring the `PtyBridge` (and its `AlacrittyEngine`) is freed even when the frontend skips explicit detach (e.g. process kill before navigation). Lock ordering is maintained: bridges lock is acquired and released before ptys lock.

**F-002 — PTY reader → bridge feed**: Changed `AppState.bridges` from `Mutex<HashMap<...>>` to `Arc<Mutex<HashMap<...>>>` so the reader thread (spawned by `spawn_pty`) can hold an `Arc` clone without needing a `'static` reference to `AppState`. The reader thread now feeds bytes to the Alacritty bridge after sending them to the xterm.js channel. Order is: xterm.js FIRST (preserves byte-identical existing behavior), then bridge feed (additive). If the bridges lock is poisoned, the feed is skipped silently — the reader thread never panics.

### HIGH fixes

**F-003 — textBaseline = "top"**: Set in both `Renderer` constructor (`alacritty-renderer.ts`) and `AlacrittyTerminalSurface.svelte`'s `onMount` so glyphs align to cell tops.

**F-004 — 256-color fallback**: Replaced `color(display-p3 0 0 0)` with `"#000000"`. The display-p3 syntax is not supported by WebKitGTK on Linux.

**F-005 — log::debug! in pty_bridge**: Replaced `#[cfg(debug_assertions)] eprintln!` with `log::debug!`. Added `log = "0.4"` to `Cargo.toml` (tracing was not in the dep tree despite the review's claim — `log` is what tauri v2 uses internally and is a lighter dep).

**F-006 — log::warn! for get_size fallback**: Added `log::warn!` with `pty_id` and error context.

**F-007 — AlacrittyTerminalSurface console.error**: Changed both `console.warn` calls to `console.error`. Removed the stale "cycle-4 may not have implemented" comment. Updated the resize-mismatch message to describe the actual failure mode.

**F-008 — encodeKey extracted**: Moved `encodeKey` into `alacritty-key-encoder.ts` with added `Escape` support. Updated `AlacrittyTerminalSurface.svelte` to import it. Wrote 20 unit tests covering printable ASCII, Enter, Backspace, Tab, Escape, all four arrow keys, and unhandled keys.

**F-009 — PaneView dispatch test**: Added `selectTerminalComponent` pure function to `config.ts` and unit-tested it in `src/__tests__/pane-view-dispatch.test.ts`. Five tests verify that `"xterm"` → `"TerminalSurface"` and `"alacritty"` → `"AlacrittyTerminalSurface"` and that they produce different selections.

**F-010 — cursor-ordering test**: Replaced `void cursorIdx; void textIdx;` suppressions with real `expect(cursorIdx).toBeGreaterThan(textIdx)`. The assertion passes because `paintCursor` is called after the cell loop in `paintSnapshot`.

**F-011 — return after resize-mismatch warn**: Added `return;` after the `console.error` in the resize-mismatch branch to prevent `paintDiff` from running with stale dimensions. Added a follow-up `invoke("resize_alacritty_engine", ...)` to trigger a fresh snapshot.

**F-012 — PaneView uses getTerminalEngine()**: Changed `$configStore.terminalEngine === "alacritty"` to `getTerminalEngine() === "alacritty"` so the normalizer (which guards against typos and unknown values) is always used.

**F-013 — ResizeObserver**: Added a `ResizeObserver` on `canvasEl` in `onMount`. On resize, recalculates `cols × rows` from new dimensions, updates canvas size, and calls `resize_alacritty_engine`. Observer is disconnected in `onDestroy`.

**F-018 — Rgb wire-contract test**: Added `wire_format_rgb_color_index_serialises_as_array` to `ipc_tests.rs`, verifying `ColorIndex::Rgb(255, 128, 0)` serializes with `"kind":"Rgb"` and `"value":[255,128,0]` (array, not object).

## What was left for Phase 2

- Full 256-color cube expansion (indices 16–255): `alacritty-renderer.ts:resolveColor` returns `"#000000"` placeholder. Needs the xterm-256 RGB formula.
- Full xterm keyboard protocol (Ctrl+letter, Alt/Meta, F-keys, modifier combos).
- Italic font loading in the renderer.

## Expedient choices

- Used `log = "0.4"` instead of `tracing` because `tracing` was not in `Cargo.toml`. The review claimed "tracing is already in the dep tree via tauri" but `cargo tree` did not confirm it as a directly accessible crate. `log` is the correct choice for a crate that does not own a tracing subscriber — tauri's subscriber will receive log records if tauri registers one.
- `selectTerminalComponent` was added to `config.ts` rather than a new utility file to avoid introducing another module for a one-liner. If this grows, it should move to `terminal-service.ts`.
- The `dist/index.html` stub was created in the worktree to allow `cargo test` to compile (`tauri::generate_context!()` panics when `frontendDist` path is missing). This is a worktree-only artifact that is gitignored via `.git/info/exclude`.
