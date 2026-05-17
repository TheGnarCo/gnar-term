//! Unit tests for `terminal_engine::input` (cycle-19).
//!
//! Tests verify that `bracketed_paste_enabled` correctly reflects DEC private
//! mode 2004 (bracketed paste) as set or cleared by VTE sequences fed to the
//! terminal.
//!
//! We use `Term<VoidListener>` (a no-op listener provided by
//! `alacritty_terminal`) rather than `MyListener` so the tests have no
//! dependency on the production event-queue machinery.

#[cfg(test)]
mod tests {
    use alacritty_terminal::event::VoidListener;
    use alacritty_terminal::grid::Dimensions;
    use alacritty_terminal::term::Config;
    use alacritty_terminal::vte::ansi::Processor;
    use alacritty_terminal::Term;

    use crate::terminal_engine::input::bracketed_paste_enabled;

    // ─── Test helpers ─────────────────────────────────────────────────────────

    /// Minimal `Dimensions` for constructing a `Term` in tests.
    struct TestSize {
        cols: usize,
        lines: usize,
    }

    impl Dimensions for TestSize {
        fn total_lines(&self) -> usize {
            self.lines
        }
        fn screen_lines(&self) -> usize {
            self.lines
        }
        fn columns(&self) -> usize {
            self.cols
        }
    }

    /// Construct a small `Term<VoidListener>` for bracketed-paste testing.
    fn test_term() -> (Term<VoidListener>, Processor) {
        let size = TestSize {
            cols: 80,
            lines: 24,
        };
        let term = Term::new(Config::default(), &size, VoidListener);
        let processor = Processor::new();
        (term, processor)
    }

    /// Feed a byte string to the terminal, advancing the VTE processor.
    fn feed(term: &mut Term<VoidListener>, processor: &mut Processor, data: &[u8]) {
        processor.advance(term, data);
    }

    // ─── Tests ───────────────────────────────────────────────────────────────

    /// Bracketed paste is off by default.
    #[test]
    fn bracketed_paste_mode_disabled_by_default() {
        let (term, _) = test_term();
        assert!(
            !bracketed_paste_enabled(&term),
            "bracketed paste must be disabled on a freshly constructed Term"
        );
    }

    /// Feed `\x1b[?2004h` (DEC set 2004) — the mode bit must be set.
    #[test]
    fn bracketed_paste_mode_toggles_on_dec_set_reset() {
        let (mut term, mut proc) = test_term();

        // Enable bracketed paste: ESC [ ? 2 0 0 4 h
        feed(&mut term, &mut proc, b"\x1b[?2004h");
        assert!(
            bracketed_paste_enabled(&term),
            "bracketed paste must be enabled after \\x1b[?2004h"
        );

        // Disable bracketed paste: ESC [ ? 2 0 0 4 l
        feed(&mut term, &mut proc, b"\x1b[?2004l");
        assert!(
            !bracketed_paste_enabled(&term),
            "bracketed paste must be disabled after \\x1b[?2004l"
        );
    }

    /// Enable twice — mode must still be on (idempotent set).
    #[test]
    fn bracketed_paste_mode_enable_is_idempotent() {
        let (mut term, mut proc) = test_term();

        feed(&mut term, &mut proc, b"\x1b[?2004h");
        feed(&mut term, &mut proc, b"\x1b[?2004h");
        assert!(
            bracketed_paste_enabled(&term),
            "bracketed paste must remain enabled after double enable"
        );
    }

    /// Disable when already disabled — mode must remain off (idempotent clear).
    #[test]
    fn bracketed_paste_mode_disable_when_already_disabled_is_safe() {
        let (mut term, mut proc) = test_term();

        feed(&mut term, &mut proc, b"\x1b[?2004l");
        assert!(
            !bracketed_paste_enabled(&term),
            "bracketed paste must remain disabled after disable on fresh term"
        );
    }

    /// Toggle on-off-on — mode tracks each sequence faithfully.
    #[test]
    fn bracketed_paste_mode_tracks_multiple_toggles() {
        let (mut term, mut proc) = test_term();

        feed(&mut term, &mut proc, b"\x1b[?2004h");
        assert!(
            bracketed_paste_enabled(&term),
            "should be enabled after first set"
        );

        feed(&mut term, &mut proc, b"\x1b[?2004l");
        assert!(
            !bracketed_paste_enabled(&term),
            "should be disabled after first reset"
        );

        feed(&mut term, &mut proc, b"\x1b[?2004h");
        assert!(
            bracketed_paste_enabled(&term),
            "should be enabled after second set"
        );
    }

    /// Other DEC private modes (e.g. ?25h — cursor visible) must not affect
    /// the bracketed-paste bit.
    #[test]
    fn bracketed_paste_mode_unrelated_dec_modes_do_not_interfere() {
        let (mut term, mut proc) = test_term();

        // ?25h — show cursor; ?47h — alternate screen
        feed(&mut term, &mut proc, b"\x1b[?25h\x1b[?47h");
        assert!(
            !bracketed_paste_enabled(&term),
            "unrelated DEC modes must not set the bracketed-paste bit"
        );
    }
}
