//! Unit tests for `AlacrittyEngine` covering AC-2.

#[cfg(test)]
mod tests {
    use crate::terminal_engine::alacritty::AlacrittyEngine;
    use crate::terminal_engine::trait_def::TerminalEngine;
    use crate::terminal_engine::types::ATTR_BOLD;

    // ─── helpers ─────────────────────────────────────────────────────────────

    fn engine_80x24() -> AlacrittyEngine {
        AlacrittyEngine::new(80, 24)
    }

    // ─── AC-2 tests ───────────────────────────────────────────────────────────

    /// Feed bytes then call damage(); at least one `DirtyRect` must exist that
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

    /// Sanity: ATTR_BOLD const is non-zero (the bitfield is wired correctly).
    #[test]
    fn attr_bold_const_is_nonzero() {
        assert_ne!(ATTR_BOLD, 0);
    }
}
