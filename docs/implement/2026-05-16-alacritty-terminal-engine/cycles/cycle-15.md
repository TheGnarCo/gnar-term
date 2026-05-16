# Cycle 15 — display_offset-aware snapshots via Grid::display_iter

## Envelope

```yaml
run_id: 2026-05-16-alacritty-terminal-engine
cycle_id: cycle-15
cycle_branch: run/2026-05-16-alacritty-terminal-engine/cycle-15
parent_sha: e548daffef6351bbe01cb0fab52d9cb1d62ed62e
acs_covered: [AC-2]
ac_test_evidence:
  AC-2: snapshot_respects_display_offset_when_scrolled
        snapshot_viewport_dimensions_invariant_under_scroll
tests_passing: 36 Rust
tests_failing: 0
deviations: none
```

## What was done

### Audit finding F-5: snapshot ignores display_offset

The old `snapshot()` iterated `Line(0)..Line(rows)` — pure grid-relative indices.
When the user scrolled via PageUp or any other `display_offset`-raising mechanism,
those indices still pointed at the bottom of the grid rather than the shifted viewport.
The visible rows were silently wrong.

### Iterator choice: Grid::display_iter over Term::renderable_content

`Grid::display_iter()` was chosen over `Term::renderable_content()` for two reasons:

1. **Minimum API surface.** `renderable_content()` is already consumed by
   `cursor_position()` via a separate call. Re-using it for both snapshot cells
   and cursor would require either calling it twice (two borrows) or threading
   `RenderableContent` through more code paths. `display_iter()` is orthogonal.

2. **Clean coordinate contract.** `display_iter()` yields `Indexed<&Cell>` items
   whose `point` is a grid-relative `Line(i32)`. The conversion to viewport row is
   a single expression: `viewport_row = point.line.0 + display_offset as i32`.
   No cursor-shape state is mixed in.

### display_offset coordinate contract (verified from upstream source)

`alacritty_terminal-0.26.0/src/grid/mod.rs`, lines 422–429:

```rust
pub fn display_iter(&self) -> GridIterator<'_, T> {
    let start = Point::new(Line(-(self.display_offset() as i32) - 1), last_column);
    let end_line = min(start.line + self.screen_lines(), self.bottommost_line());
    GridIterator { grid: self, point: start, end }
}
```

- When `display_offset = 0`: start = `Line(-1)`, iterator advances to `Line(0)..Line(rows-1)`.
  Viewport row = `line.0 + 0 = line.0`. This matches the old behavior.
- When `display_offset = N`: start = `Line(-N-1)`, end = `Line(rows-1-N)`.
  Viewport row = `line.0 + N`, which ranges from 0 to rows-1.

The `Indexed` items carry the RAW grid-relative `Line(i32)` — NOT a pre-converted
viewport usize. Callers must add `display_offset` to obtain the viewport row.

### damage() Partial arm fix

`TermDamageIterator::next` (verified at `term/mod.rs` line 208):

```rust
line.is_damaged().then_some(LineDamageBounds::new(
    line.line + self.display_offset,   // <-- display_offset already added
    line.left,
    line.right,
))
```

`b.line` out of `TermDamageIterator` is **viewport-relative** (0..rows). The old
`map_row(Line(b.line as i32))` treated it as grid-relative — correct only when
`display_offset = 0`. Fixed to `Line(b.line as i32 - display_offset as i32)`,
which converts the viewport row back to the grid-relative line that `map_row` expects.

### scroll_up_by API

`AlacrittyEngine::scroll_up_by(lines: usize)` calls:

```rust
self.term.grid_mut().scroll_display(Scroll::Delta(lines as i32));
```

`Scroll::Delta(n)` adds `n` to `display_offset` (clamped to `history_size`), so
positive `n` scrolls toward older history (up). This matches the semantics of
PageUp / scrollback navigation. The method is `pub` so tests can drive it directly;
production scrolling is driven by VTE sequences that call `scroll_display` internally.

### New tests

- `snapshot_respects_display_offset_when_scrolled` — fills 10 lines into a 5-row
  viewport, confirms row 3 = "line009" before scroll, then scrolls up 3 and confirms
  row 3 = "line006" and "line009" is gone from view. Fails against the old code,
  passes against the new `display_iter`-based snapshot.
- `snapshot_viewport_dimensions_invariant_under_scroll` — confirms `rows`, `cols`,
  and per-row cell counts are all unchanged after `scroll_up_by`.

## What is still deferred

- **Scroll-event routing from frontend to engine**: keyboard scroll events (PageUp/
  PageDown from xterm.js) are not yet wired to `scroll_up_by` / `scroll_display`.
  A future cycle must intercept these key events before forwarding to the PTY and
  instead drive `AlacrittyEngine::scroll_up_by` (or a signed equivalent).
- **damage() under active scroll**: when `display_offset > 0` and content arrives,
  alacritty_terminal emits `TermDamage::Full` (noted at `term/mod.rs` line 482:
  "damage which changes all content when display offset is non-zero is handled via
  full damage"). The `Full` arm now correctly maps viewport rows using `display_offset`,
  so no cells are misread. No additional work needed here.
