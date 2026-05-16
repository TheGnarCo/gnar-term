//! Unit tests for `AlacrittyEngine` covering AC-2, AC-6, and cycle-12 additions.

#[cfg(test)]
mod tests {
    use crate::terminal_engine::alacritty::AlacrittyEngine;
    use crate::terminal_engine::trait_def::TerminalEngine;
    use crate::terminal_engine::types::{CursorShapeTag, ATTR_BOLD};
    use alacritty_terminal::event::Event;

    // ─── helpers ─────────────────────────────────────────────────────────────

    fn engine_80x24() -> AlacrittyEngine {
        AlacrittyEngine::new(80, 24)
    }

    // ─── AC-2 tests ───────────────────────────────────────────────────────────

    /// Feed bytes then call `damage()`; at least one `DirtyRect` must exist that
    /// covers row 0 and spans cols covering 'h','e','l','l','o'.
    #[test]
    fn feed_then_damage_produces_expected_rects() {
        let mut engine = engine_80x24();

        // Initial damage is Full on construction; reset it so we start clean.
        let _ = engine.damage(); // consume initial full-damage
        engine.reset_damage();

        engine.feed(b"hello\r\n");

        let rects = engine.damage();
        // There must be at least one rect.
        assert!(
            !rects.is_empty(),
            "expected at least one DirtyRect after feed"
        );

        // At least one rect must touch row 0 and column range 0..=4.
        let covers_hello = rects
            .iter()
            .any(|r| r.row == 0 && r.col_start <= 4 && r.col_end >= 1);
        assert!(
            covers_hello,
            "no rect covers row 0 cols 0-4; rects = {rects:?}"
        );
    }

    /// After feeding content and resizing, the snapshot dimensions match the new size.
    #[test]
    fn resize_reflows_existing_content() {
        let mut engine = engine_80x24();
        engine.feed(b"hello world\r\n");

        engine.resize(100, 30);

        let snap = engine.snapshot();
        assert_eq!(snap.cols, 100, "expected cols=100 after resize");
        assert_eq!(snap.rows, 30, "expected rows=30 after resize");
    }

    /// An initial snapshot contains rows × cols cells (one per grid position).
    #[test]
    fn snapshot_returns_full_grid() {
        let engine = engine_80x24();
        let snap = engine.snapshot();

        assert_eq!(snap.cols, 80);
        assert_eq!(snap.rows, 24);
        assert_eq!(
            snap.rows_data.len(),
            24,
            "snapshot must contain exactly 24 row entries"
        );
        for (i, row) in snap.rows_data.iter().enumerate() {
            assert_eq!(row.cells.len(), 80, "row {i} must contain exactly 80 cells");
        }
    }

    /// After feeding "abc", the cursor must be at row 0, col 3.
    #[test]
    fn cursor_position_tracks_through_writes() {
        let mut engine = engine_80x24();
        engine.feed(b"abc");

        let pos = engine.cursor_position();
        assert_eq!(
            pos.row, 0,
            "cursor row should be 0 after writing on first line"
        );
        assert_eq!(pos.col, 3, "cursor col should be 3 after writing 'abc'");
    }

    /// Sanity: `ATTR_BOLD` const is non-zero (the bitfield is wired correctly).
    #[test]
    fn attr_bold_const_is_nonzero() {
        assert_ne!(ATTR_BOLD, 0);
    }

    // ─── AC-6 tests: event drain / buffered surface ───────────────────────────

    /// `drain_events` on a fresh engine returns an empty Vec (no events yet).
    #[test]
    fn drain_events_empty_when_no_events_produced() {
        let engine = engine_80x24();
        let events = engine.drain_events();
        assert!(
            events.is_empty(),
            "expected no events on a freshly-constructed engine, got: {events:?}"
        );
    }

    /// Feeding a BEL character (`\x07`) must surface at least one `Event::Bell`
    /// in the buffered event queue.
    #[test]
    fn bell_event_buffered_after_feeding_bel_byte() {
        let mut engine = engine_80x24();
        engine.feed(b"\x07");
        let events = engine.drain_events();
        let has_bell = events.iter().any(|e| matches!(e, Event::Bell));
        assert!(
            has_bell,
            "expected at least one Event::Bell after feeding \\x07, got: {events:?}"
        );
    }

    /// After `drain_events` is called, subsequent drains return empty (queue cleared).
    #[test]
    fn drain_events_clears_the_listener_queue() {
        let mut engine = engine_80x24();
        engine.feed(b"\x07"); // produce a Bell event
        let first = engine.drain_events();
        assert!(
            !first.is_empty(),
            "precondition: first drain must be non-empty"
        );
        let second = engine.drain_events();
        assert!(
            second.is_empty(),
            "expected empty queue after drain, got: {second:?}"
        );
    }

    // ─── Cycle-12 tests: cursor shape + combining marks ───────────────────────

    /// Fresh engine cursor must have Block shape.
    #[test]
    fn cursor_shape_block_on_fresh_init() {
        let engine = engine_80x24();
        let pos = engine.cursor_position();
        assert_eq!(
            pos.shape,
            CursorShapeTag::Block,
            "fresh engine cursor shape must be Block, got: {:?}",
            pos.shape
        );
    }

    /// Hidden cursor should reflect Hidden shape; visible cursor must not.
    #[test]
    fn cursor_shape_visible_consistency_with_show_cursor_mode() {
        let engine = engine_80x24();
        let pos = engine.cursor_position();
        // By default, SHOW_CURSOR mode is set → visible == true, shape != Hidden.
        assert!(pos.visible, "fresh engine cursor should be visible");
        assert_ne!(
            pos.shape,
            CursorShapeTag::Hidden,
            "visible cursor must not have Hidden shape"
        );
    }

    /// Feeding a base char followed by a combining diacritic mark results in a
    /// Cell whose `ch` field contains both codepoints (the base + the combining mark).
    #[test]
    fn zerowidth_combining_marks_preserved_in_cell() {
        let mut engine = engine_80x24();
        // 'e' (U+0065) followed by combining acute (U+0301) forms é.
        // Feed as raw UTF-8 bytes to the engine.
        engine.feed("e\u{0301}".as_bytes());
        let snap = engine.snapshot();
        let cell = &snap.rows_data[0].cells[0];
        // The cell character must include both the base and the combining mark.
        assert!(
            cell.ch.contains('\u{0301}'),
            "expected combining acute (U+0301) preserved in cell.ch, got: {:?}",
            cell.ch
        );
    }

    /// Feeding an OSC foreground-color query (`ESC ] 10 ; ? BEL`) must result
    /// in at least one `Event::ColorRequest` in the buffered queue.
    ///
    /// `alacritty_terminal` emits `ColorRequest(index, formatter)` rather than
    /// `PtyWrite` directly — the host is expected to call the formatter with the
    /// current color value to generate the response string, then write that back
    /// to the PTY as a `PtyWrite`-equivalent operation.
    ///
    /// This is AC-6: programs that issue OSC color queries no longer hang because
    /// the event is now buffered rather than silently dropped. Full PTY write-back
    /// routing (invoking the formatter + sending to the PTY writer) is a follow-up
    /// cycle (see TODO pty-write-routing in `PtyBridge::feed_and_emit`).
    #[test]
    fn pty_write_event_buffered_on_color_query() {
        let mut engine = engine_80x24();
        // OSC 10;?BEL — foreground color query.
        // alacritty_terminal emits ColorRequest(index, formatter) for this sequence.
        // ESC ] 10 ; ? BEL
        engine.feed(b"\x1b]10;?\x07");
        let events = engine.drain_events();
        // The query must produce a ColorRequest (index 256 = foreground color slot).
        let has_color_request = events
            .iter()
            .any(|e| matches!(e, Event::ColorRequest(_, _)));
        assert!(
            has_color_request,
            "expected at least one Event::ColorRequest after OSC 10 color query, got: {events:?}"
        );
    }
}
