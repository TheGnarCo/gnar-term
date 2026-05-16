//! `AlacrittyEngine` — concrete `TerminalEngine` impl backed by
//! `alacritty_terminal::Term` + `vte::ansi::Processor`.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::color::Colors;
use alacritty_terminal::term::{Config, TermDamage};
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor, Processor};
use alacritty_terminal::Term;

use super::trait_def::TerminalEngine;
use super::types::{
    Cell, ColorIndex, CursorPos, CursorShapeTag, DirtyRect, GridSnapshot, NamedSlot, RowData,
    ATTR_BOLD, ATTR_DIM, ATTR_HIDDEN, ATTR_INVERSE, ATTR_ITALIC, ATTR_STRIKEOUT, ATTR_UNDERLINE,
    ATTR_WIDE_CHAR,
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
/// # Mapping strategy (cycle-14)
///
/// The upstream `NamedColor` enum has two disjoint ranges:
///
/// - **Palette range** (`Black=0`..`BrightWhite=15`): these are interchangeable
///   with the 16-color ANSI palette and are emitted as `ColorIndex::Indexed`.
///   No semantic identity is lost — `Black` and `Indexed(0)` are definitionally
///   the same color.
///
/// - **Semantic range** (`Foreground=256`, `Background=257`, `Cursor=258`,
///   `DimBlack=259`..`DimWhite=266`, `BrightForeground=267`, `DimForeground=268`):
///   these identify *slots* rather than specific colors. Collapsing them to
///   palette indices (as the old code did) erased OSC 10/11/12 theme overrides
///   and conflated `Foreground` with `White` (both → 7). They are now emitted
///   as `ColorIndex::Named(NamedSlot)` so the renderer can resolve them against
///   a theme palette.
fn map_color(color: Color) -> ColorIndex {
    match color {
        Color::Named(named) => match named {
            // ── Palette range (0-15): collapse to Indexed — no semantic loss ──
            NamedColor::Black => ColorIndex::Indexed(0),
            NamedColor::Red => ColorIndex::Indexed(1),
            NamedColor::Green => ColorIndex::Indexed(2),
            NamedColor::Yellow => ColorIndex::Indexed(3),
            NamedColor::Blue => ColorIndex::Indexed(4),
            NamedColor::Magenta => ColorIndex::Indexed(5),
            NamedColor::Cyan => ColorIndex::Indexed(6),
            NamedColor::White => ColorIndex::Indexed(7),
            NamedColor::BrightBlack => ColorIndex::Indexed(8),
            NamedColor::BrightRed => ColorIndex::Indexed(9),
            NamedColor::BrightGreen => ColorIndex::Indexed(10),
            NamedColor::BrightYellow => ColorIndex::Indexed(11),
            NamedColor::BrightBlue => ColorIndex::Indexed(12),
            NamedColor::BrightMagenta => ColorIndex::Indexed(13),
            NamedColor::BrightCyan => ColorIndex::Indexed(14),
            NamedColor::BrightWhite => ColorIndex::Indexed(15),
            // ── Semantic range (256-268): preserve as Named slot ──────────────
            NamedColor::Foreground => ColorIndex::Named(NamedSlot::Foreground),
            NamedColor::Background => ColorIndex::Named(NamedSlot::Background),
            NamedColor::Cursor => ColorIndex::Named(NamedSlot::Cursor),
            NamedColor::DimBlack => ColorIndex::Named(NamedSlot::DimBlack),
            NamedColor::DimRed => ColorIndex::Named(NamedSlot::DimRed),
            NamedColor::DimGreen => ColorIndex::Named(NamedSlot::DimGreen),
            NamedColor::DimYellow => ColorIndex::Named(NamedSlot::DimYellow),
            NamedColor::DimBlue => ColorIndex::Named(NamedSlot::DimBlue),
            NamedColor::DimMagenta => ColorIndex::Named(NamedSlot::DimMagenta),
            NamedColor::DimCyan => ColorIndex::Named(NamedSlot::DimCyan),
            NamedColor::DimWhite => ColorIndex::Named(NamedSlot::DimWhite),
            NamedColor::BrightForeground => ColorIndex::Named(NamedSlot::BrightForeground),
            NamedColor::DimForeground => ColorIndex::Named(NamedSlot::DimForeground),
        },
        Color::Spec(rgb) => ColorIndex::Rgb(rgb.r, rgb.g, rgb.b),
        Color::Indexed(idx) => ColorIndex::Indexed(idx),
    }
}

// ─── Cursor shape mapping ─────────────────────────────────────────────────────

/// Map `alacritty_terminal::vte::ansi::CursorShape` to our `CursorShapeTag`.
fn map_cursor_shape(shape: CursorShape) -> CursorShapeTag {
    match shape {
        CursorShape::Block => CursorShapeTag::Block,
        CursorShape::Underline => CursorShapeTag::Underline,
        CursorShape::Beam => CursorShapeTag::Beam,
        CursorShape::HollowBlock => CursorShapeTag::HollowBlock,
        CursorShape::Hidden => CursorShapeTag::Hidden,
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

    /// Expose the terminal's color table for use by event consumers (e.g. `PtyBridge`
    /// routing `ColorRequest` events).
    ///
    /// `alacritty_terminal::Term::colors()` returns a reference to the internal
    /// `Colors` array (269 slots: ANSI 0-15, 256-color cube, grayscale ramp,
    /// plus named slots for Foreground/Background/Cursor etc.). Each slot is
    /// `Option<Rgb>` — `None` means the color was never explicitly set and the
    /// terminal-emulator should fall back to a default.
    pub fn colors(&self) -> &Colors {
        self.term.colors()
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
    ///
    /// Cycle-12: added `ATTR_DIM`, `ATTR_HIDDEN`, `ATTR_STRIKEOUT`, `ATTR_WIDE_CHAR`
    /// and zero-width combining mark preservation in `Cell::ch`.
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
                if acell.flags.contains(Flags::DIM) {
                    attrs |= ATTR_DIM;
                }
                if acell.flags.contains(Flags::HIDDEN) {
                    attrs |= ATTR_HIDDEN;
                }
                if acell.flags.contains(Flags::STRIKEOUT) {
                    attrs |= ATTR_STRIKEOUT;
                }
                if acell.flags.contains(Flags::WIDE_CHAR) {
                    attrs |= ATTR_WIDE_CHAR;
                }

                // Build the cell character, appending any zero-width combining marks.
                // alacritty_terminal stores combining diacritics in `acell.zerowidth()`.
                // Dropping them (as `acell.c.to_string()` did) loses grapheme clusters
                // like "e\u{0301}" → "é".
                let ch = if let Some(zw) = acell.zerowidth() {
                    let mut s = String::with_capacity(4 + zw.len() * 4);
                    s.push(acell.c);
                    for &c in zw {
                        s.push(c);
                    }
                    s
                } else {
                    acell.c.to_string()
                };

                Cell {
                    ch,
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
        // `Term::renderable_content()` is the public API that produces a
        // `RenderableContent` carrying a `RenderableCursor`. The cursor inside
        // correctly handles vi-mode, cursor style overrides, and visibility in
        // one place (audit recommendation F-3). Specifically, it sets
        // `shape = CursorShape::Hidden` when `SHOW_CURSOR` mode is off outside
        // vi-mode — which replaces the manual `mode().contains(TermMode::SHOW_CURSOR)`
        // check we previously performed.
        //
        // `RenderableCursor::new` is private; the public access path is via
        // `Term::renderable_content()`.
        let content = self.term.renderable_content();
        let rc = content.cursor;

        let row = rc.point.line.0.max(0) as u16;
        let col = rc.point.column.0 as u16;

        let shape = map_cursor_shape(rc.shape);
        // `visible` is derived from shape for backwards-compatibility with renderers
        // that test `pos.visible` without inspecting `shape`.
        let visible = shape != CursorShapeTag::Hidden;

        CursorPos {
            row,
            col,
            visible,
            shape,
        }
    }
}
