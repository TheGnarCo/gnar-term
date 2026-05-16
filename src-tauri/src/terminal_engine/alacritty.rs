//! `AlacrittyEngine` — concrete `TerminalEngine` impl backed by
//! `alacritty_terminal::Term` + `vte::ansi::Processor`.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::{Config, TermDamage, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor};
use alacritty_terminal::Term;

use super::trait_def::TerminalEngine;
use super::types::{
    Cell, ColorIndex, CursorPos, DirtyRect, GridSnapshot, RowData, ATTR_BOLD, ATTR_INVERSE,
    ATTR_ITALIC, ATTR_UNDERLINE,
};

// ─── Size helper ─────────────────────────────────────────────────────────────

/// Minimal `Dimensions` implementation that owns its dimensions.
///
/// `alacritty_terminal::Term::new` requires a `&D where D: Dimensions`, but
/// the only public concrete implementation in the library is hidden behind
/// `#[cfg(test)]`. We roll our own for production use.
struct TermSize {
    cols: usize,
    lines: usize,
}

impl Dimensions for TermSize {
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

// ─── Event listener ──────────────────────────────────────────────────────────

/// An `EventListener` that buffers `Event`s emitted by `alacritty_terminal::Term`.
///
/// `send_event` takes `&self` (immutable), so interior mutability via
/// `Arc<Mutex<VecDeque<Event>>>` is required. The `Arc` lets `AlacrittyEngine`
/// hold a separate handle to the same queue for draining.
///
/// # Thread-safety note
///
/// `alacritty_terminal::Term` calls `send_event` synchronously during VTE
/// processing on the same thread that calls `Processor::advance`. The `Mutex`
/// guard is held for the single `push_back` call, then immediately released —
/// there is no concurrent writer, so contention is impossible in practice.
/// The `Arc` handle on `AlacrittyEngine` side is also accessed from the same
/// thread. No deadlock or race is possible.
pub struct MyListener {
    events: Arc<Mutex<VecDeque<Event>>>,
}

impl MyListener {
    fn new() -> (Self, Arc<Mutex<VecDeque<Event>>>) {
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let listener = Self {
            events: Arc::clone(&queue),
        };
        (listener, queue)
    }
}

impl EventListener for MyListener {
    fn send_event(&self, event: Event) {
        match self.events.lock() {
            Ok(mut guard) => guard.push_back(event),
            Err(poisoned) => {
                // A poisoned mutex means another thread panicked while holding
                // the lock — extremely unlikely in our single-threaded use, but
                // we recover rather than panic the PTY reader thread.
                log::debug!("[alacritty_engine] event queue mutex poisoned; recovering");
                poisoned.into_inner().push_back(event);
            }
        }
    }
}

// ─── Color mapping ───────────────────────────────────────────────────────────

/// Map a `vte::ansi::Color` to our `ColorIndex`.
///
/// Named colors are given their conventional ANSI/xterm palette index
/// (0–15). Default foreground → 7, default background → 0. Any
/// out-of-range named variant falls back to `Indexed(0)`.
#[allow(clippy::match_same_arms)] // keeping each arm explicit is intentional
fn map_color(color: Color) -> ColorIndex {
    match color {
        Color::Named(named) => {
            let idx = match named {
                NamedColor::Black => 0,
                NamedColor::Red => 1,
                NamedColor::Green => 2,
                NamedColor::Yellow => 3,
                NamedColor::Blue => 4,
                NamedColor::Magenta => 5,
                NamedColor::Cyan => 6,
                NamedColor::White | NamedColor::Foreground => 7,
                NamedColor::Background => 0,
                NamedColor::BrightBlack | NamedColor::DimBlack => 8,
                NamedColor::BrightRed | NamedColor::DimRed => 9,
                NamedColor::BrightGreen | NamedColor::DimGreen => 10,
                NamedColor::BrightYellow | NamedColor::DimYellow => 11,
                NamedColor::BrightBlue | NamedColor::DimBlue => 12,
                NamedColor::BrightMagenta | NamedColor::DimMagenta => 13,
                NamedColor::BrightCyan | NamedColor::DimCyan => 14,
                NamedColor::BrightWhite | NamedColor::DimWhite => 15,
                NamedColor::BrightForeground | NamedColor::DimForeground => 7,
                // Cursor color has no palette equivalent; fall back to default fg.
                NamedColor::Cursor => 7,
            };
            ColorIndex::Indexed(idx)
        }
        Color::Spec(rgb) => ColorIndex::Rgb(rgb.r, rgb.g, rgb.b),
        Color::Indexed(idx) => ColorIndex::Indexed(idx),
    }
}

// ─── AlacrittyEngine ─────────────────────────────────────────────────────────

/// `TerminalEngine` implementation wrapping `alacritty_terminal::Term`.
///
/// Callers must hold this behind a `Mutex` — the engine is `Send` but not
/// `Sync`, enforced by the trait bound.
pub struct AlacrittyEngine {
    term: Term<MyListener>,
    processor: Processor,
    cols: u16,
    rows: u16,
    /// Shared queue with `MyListener`; used to drain events after each `feed`.
    event_queue: Arc<Mutex<VecDeque<Event>>>,
}

impl AlacrittyEngine {
    /// Construct a new engine with an `cols × rows` viewport.
    pub fn new(cols: u16, rows: u16) -> Self {
        let size = TermSize {
            cols: cols as usize,
            lines: rows as usize,
        };
        let (listener, event_queue) = MyListener::new();
        let term = Term::new(Config::default(), &size, listener);
        let processor = Processor::new();
        Self {
            term,
            processor,
            cols,
            rows,
            event_queue,
        }
    }

    /// Drain all buffered events emitted since the last call (or since construction).
    ///
    /// Each call to `feed` may cause `alacritty_terminal::Term` to invoke
    /// `MyListener::send_event` one or more times. Those events accumulate in the
    /// shared queue until this method is called.
    ///
    /// # `PtyWrite` events
    ///
    /// `Event::PtyWrite` carries a response string that the terminal expects to be
    /// written back to the PTY (e.g., a color-query response). **Callers are
    /// responsible for routing these bytes to the PTY writer.** Dropping them
    /// causes the querying program to hang indefinitely waiting for a response.
    ///
    /// Full PTY write-back routing (cross-component plumbing with `AppState.ptys`)
    /// is deferred to a follow-up cycle. This method surfaces the events so they
    /// are no longer silently lost.
    ///
    /// # Other events
    ///
    /// Non-PtyWrite events (`Bell`, `Title`, `Exit`, etc.) are logged at debug
    /// level by `PtyBridge::feed_and_emit` and otherwise passed through to the
    /// caller; they do not cause programs to hang.
    pub fn drain_events(&self) -> Vec<Event> {
        match self.event_queue.lock() {
            Ok(mut guard) => guard.drain(..).collect(),
            Err(poisoned) => {
                log::debug!(
                    "[alacritty_engine] event queue mutex poisoned during drain; recovering"
                );
                poisoned.into_inner().drain(..).collect()
            }
        }
    }

    /// Map a row of alacritty `Cell`s into a `RowData`.
    fn map_row(&self, line_idx: alacritty_terminal::index::Line) -> RowData {
        use alacritty_terminal::term::cell::Flags;

        let row = &self.term.grid()[line_idx];
        let cells = (0..self.cols as usize)
            .map(|col| {
                use alacritty_terminal::index::Column;
                let acell = &row[Column(col)];
                let mut attrs: u8 = 0;
                if acell.flags.contains(Flags::BOLD) {
                    attrs |= ATTR_BOLD;
                }
                if acell.flags.intersects(Flags::ALL_UNDERLINES) {
                    attrs |= ATTR_UNDERLINE;
                }
                if acell.flags.contains(Flags::INVERSE) {
                    attrs |= ATTR_INVERSE;
                }
                if acell.flags.contains(Flags::ITALIC) {
                    attrs |= ATTR_ITALIC;
                }

                Cell {
                    ch: acell.c.to_string(),
                    fg: map_color(acell.fg),
                    bg: map_color(acell.bg),
                    attrs,
                }
            })
            .collect();
        RowData { cells }
    }
}

impl TerminalEngine for AlacrittyEngine {
    fn feed(&mut self, bytes: &[u8]) {
        self.processor.advance(&mut self.term, bytes);
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        self.cols = cols;
        self.rows = rows;
        let size = TermSize {
            cols: cols as usize,
            lines: rows as usize,
        };
        self.term.resize(size);
    }

    fn snapshot(&self) -> GridSnapshot {
        use alacritty_terminal::index::Line;

        let rows_data = (0..self.rows as usize)
            .map(|r| self.map_row(Line(r as i32)))
            .collect();

        let cursor = self.cursor_position();

        GridSnapshot {
            cols: self.cols,
            rows: self.rows,
            cursor,
            rows_data,
        }
    }

    fn damage(&mut self) -> Vec<DirtyRect> {
        let cols = self.cols;
        let rows = self.rows;

        // Collect damage before calling reset_damage.
        let term_damage = self.term.damage();
        let rects: Vec<DirtyRect> = match term_damage {
            TermDamage::Full => {
                // Entire viewport is dirty — return one rect per row covering all cols.
                (0..rows)
                    .map(|r| {
                        use alacritty_terminal::index::Line;
                        let row_data = self.map_row(Line(i32::from(r)));
                        DirtyRect {
                            row: r,
                            col_start: 0,
                            col_end: cols,
                            cells: row_data.cells,
                        }
                    })
                    .collect()
            }
            TermDamage::Partial(iter) => {
                let bounds: Vec<_> = iter.collect();
                bounds
                    .into_iter()
                    .map(|b| {
                        use alacritty_terminal::index::Line;
                        let row = b.line as u16;
                        let col_start = b.left as u16;
                        // col_end is exclusive; LineDamageBounds.right is inclusive.
                        let col_end = (b.right as u16).saturating_add(1).min(cols);
                        let row_data = self.map_row(Line(b.line as i32));
                        let cells = row_data.cells[col_start as usize..col_end as usize].to_vec();
                        DirtyRect {
                            row,
                            col_start,
                            col_end,
                            cells,
                        }
                    })
                    .collect()
            }
        };

        self.term.reset_damage();
        rects
    }

    fn reset_damage(&mut self) {
        self.term.reset_damage();
    }

    fn cursor_position(&self) -> CursorPos {
        let grid = self.term.grid();
        let point = grid.cursor.point;
        let visible = self.term.mode().contains(TermMode::SHOW_CURSOR);
        // `point.line` is 0-based within the viewport for normal (non-scrolled) state.
        let row = point.line.0.max(0) as u16;
        let col = point.column.0 as u16;
        CursorPos { row, col, visible }
    }
}
