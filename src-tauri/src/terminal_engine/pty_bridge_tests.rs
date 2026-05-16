//! Unit tests for the PTY <-> engine bridge (cycle-4, cycle-12).
//!
//! These tests drive `PtyBridge` directly without spawning a real PTY.
//! A `TestSink` records all emitted `TerminalChannelMessage` payloads so
//! assertions can inspect the emitted stream without a live Tauri Channel.
//!
//! Cycle-12 additions:
//! - `TestWriter`: a `Write + Send` impl backed by `Arc<Mutex<Vec<u8>>>` used
//!   to verify that `PtyWrite` and `ColorRequest` events route bytes back to
//!   the PTY writer.

use std::io::Write;
use std::sync::{Arc, Mutex};

use super::pty_bridge::{MessageSink, PtyBridge, TerminalChannelMessage};

// ─── TestSink ─────────────────────────────────────────────────────────────────

/// A `MessageSink` implementation that accumulates emitted messages into a Vec.
#[derive(Default, Clone)]
struct TestSink {
    messages: Arc<Mutex<Vec<TerminalChannelMessage>>>,
}

impl TestSink {
    fn new() -> Self {
        Self::default()
    }

    fn messages(&self) -> Vec<TerminalChannelMessage> {
        self.messages.lock().unwrap().clone()
    }
}

impl MessageSink for TestSink {
    fn send(&self, msg: TerminalChannelMessage) -> Result<(), String> {
        self.messages.lock().unwrap().push(msg);
        Ok(())
    }
}

// ─── TestWriter ───────────────────────────────────────────────────────────────

/// A `Write + Send` implementation that accumulates all written bytes.
///
/// Backed by `Arc<Mutex<Vec<u8>>>` so the test can clone a handle and inspect
/// the written bytes after `PtyBridge` has dropped its reference.
#[derive(Clone, Default)]
struct TestWriter {
    buf: Arc<Mutex<Vec<u8>>>,
}

impl TestWriter {
    fn new() -> Self {
        Self::default()
    }

    /// Return a copy of all bytes written so far.
    fn written(&self) -> Vec<u8> {
        self.buf.lock().unwrap().clone()
    }
}

impl Write for TestWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.buf.lock().unwrap().extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// ─── Helper constructors ─────────────────────────────────────────────────────

fn make_bridge(cols: u16, rows: u16) -> (PtyBridge, TestSink) {
    let sink = TestSink::new();
    let bridge = PtyBridge::new(cols, rows, Box::new(sink.clone()), None);
    (bridge, sink)
}

fn make_bridge_with_writer(cols: u16, rows: u16) -> (PtyBridge, TestSink, TestWriter) {
    let sink = TestSink::new();
    let writer = TestWriter::new();
    let bridge = PtyBridge::new(
        cols,
        rows,
        Box::new(sink.clone()),
        Some(Box::new(writer.clone())),
    );
    (bridge, sink, writer)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/// attach: initial attach emits exactly one Snapshot message.
#[test]
fn attach_emits_exactly_one_snapshot_message() {
    let (bridge, sink) = make_bridge(80, 24);
    // The bridge emits the snapshot during construction/attach.
    let msgs = sink.messages();
    assert_eq!(msgs.len(), 1, "Expected exactly one message on attach");
    match &msgs[0] {
        TerminalChannelMessage::Snapshot(snap) => {
            assert_eq!(snap.cols, 80);
            assert_eq!(snap.rows, 24);
        }
        TerminalChannelMessage::Diff(other) => {
            panic!("Expected Snapshot, got Diff {other:?}");
        }
    }
    drop(bridge);
}

/// payload/griddiff: feed bytes then poll → emits a Diff covering changed cells.
#[test]
fn feed_bytes_emits_griddiff_payload_with_damage() {
    let (mut bridge, sink) = make_bridge(80, 24);
    // Clear the initial snapshot message count reference point.
    let count_before = sink.messages().len();

    bridge.feed_and_emit(b"hello");

    let msgs = sink.messages();
    let new_msgs = &msgs[count_before..];
    assert!(
        !new_msgs.is_empty(),
        "Expected at least one Diff after feed"
    );
    match &new_msgs[0] {
        TerminalChannelMessage::Diff(diff) => {
            assert_eq!(diff.cols, 80);
            assert_eq!(diff.rows, 24);
            // 'hello' should produce dirty cells
            assert!(
                !diff.dirty.is_empty(),
                "Expected non-empty dirty rects for 'hello'"
            );
        }
        TerminalChannelMessage::Snapshot(other) => {
            panic!("Expected Diff, got Snapshot {other:?}");
        }
    }
}

/// bridge/channel: snapshot arrives before any diff — ordering invariant.
#[test]
fn bridge_channel_snapshot_arrives_before_any_diff() {
    let (mut bridge, sink) = make_bridge(80, 24);
    bridge.feed_and_emit(b"burst-data-1");
    bridge.feed_and_emit(b"burst-data-2");
    bridge.feed_and_emit(b"burst-data-3");

    let msgs = sink.messages();
    assert!(!msgs.is_empty(), "Must have at least one message");
    // First message MUST be a Snapshot.
    match &msgs[0] {
        TerminalChannelMessage::Snapshot(_) => {}
        TerminalChannelMessage::Diff(d) => {
            panic!("First message must be Snapshot, got Diff {d:?}");
        }
    }
    // All subsequent messages must be Diffs.
    for (i, msg) in msgs.iter().enumerate().skip(1) {
        match msg {
            TerminalChannelMessage::Diff(_) => {}
            TerminalChannelMessage::Snapshot(s) => {
                panic!("Message {i} should be Diff, got Snapshot {s:?}");
            }
        }
    }
}

/// cursor/snapshot: resize emits a Snapshot (not a Diff), because reflow
/// can change every cell and the renderer must discard its current grid.
#[test]
fn resize_emits_snapshot_not_diff_cursor_position_updated() {
    let (mut bridge, sink) = make_bridge(80, 24);
    // Write some content first.
    bridge.feed_and_emit(b"hello world");

    let count_before = sink.messages().len();

    // Resize — this MUST emit a Snapshot.
    bridge.resize_and_emit(120, 40);

    let msgs = sink.messages();
    let new_msgs = &msgs[count_before..];
    assert!(!new_msgs.is_empty(), "Expected a Snapshot after resize");
    match &new_msgs[0] {
        TerminalChannelMessage::Snapshot(snap) => {
            assert_eq!(snap.cols, 120, "Snapshot must reflect new cols");
            assert_eq!(snap.rows, 40, "Snapshot must reflect new rows");
        }
        TerminalChannelMessage::Diff(other) => {
            panic!("Expected Snapshot after resize, got Diff {other:?}");
        }
    }
    // Only one message on resize: the snapshot (no separate diff).
    assert_eq!(new_msgs.len(), 1, "Resize should emit exactly one Snapshot");
}

/// damage: after resize, snapshot `rows_data` length matches new row count.
#[test]
fn resize_snapshot_damage_covers_full_viewport() {
    let (mut bridge, sink) = make_bridge(40, 10);
    let count_before = sink.messages().len();
    bridge.resize_and_emit(60, 15);

    let msgs = sink.messages();
    let new_msgs = &msgs[count_before..];
    match &new_msgs[0] {
        TerminalChannelMessage::Snapshot(snap) => {
            assert_eq!(
                snap.rows_data.len(),
                15,
                "Snapshot rows_data.len must equal new rows"
            );
            assert_eq!(snap.cols, 60);
        }
        TerminalChannelMessage::Diff(other) => {
            panic!("Expected Snapshot, got Diff {other:?}");
        }
    }
}

/// pty/channel: dropped channel sink (error return) does not panic.
#[test]
fn pty_channel_drop_does_not_panic() {
    /// A sink that always returns an error (simulating a dropped receiver).
    struct DroppedSink;
    impl MessageSink for DroppedSink {
        fn send(&self, _msg: TerminalChannelMessage) -> Result<(), String> {
            Err("receiver dropped".to_string())
        }
    }

    let mut bridge = PtyBridge::new(80, 24, Box::new(DroppedSink), None);
    // Even though the first send fails (DroppedSink returns Err), construction
    // must not panic. Further operations also must not panic.
    bridge.feed_and_emit(b"hello");
    bridge.resize_and_emit(40, 12);
    // No panic reaching here = pass.
}

/// bridge/snapshot: snapshot `rows_data` length equals rows on initial attach.
#[test]
fn snapshot_rows_data_length_matches_viewport_rows() {
    let (bridge, sink) = make_bridge(80, 24);
    let msgs = sink.messages();
    match &msgs[0] {
        TerminalChannelMessage::Snapshot(snap) => {
            assert_eq!(
                snap.rows_data.len(),
                24,
                "Initial snapshot must have rows_data.len == rows"
            );
            for (i, row) in snap.rows_data.iter().enumerate() {
                assert_eq!(row.cells.len(), 80, "Row {i} cell count must equal cols");
            }
        }
        TerminalChannelMessage::Diff(other) => {
            panic!("Expected Snapshot, got Diff {other:?}");
        }
    }
    drop(bridge);
}

/// cached/viewport/dimensions/bridge: after `resize_and_emit` the diff emitted by
/// the next `feed_and_emit` carries the new dimensions — confirms cached fields
/// on `PtyBridge` stay consistent with the engine's actual viewport.
///
/// This test guards against drift: if a future code path mutates the engine's
/// size without updating `PtyBridge::cols`/`rows`, the diff payload would carry
/// stale dimensions and the renderer would silently display the wrong geometry.
///
/// The "snapshot dimensions == diff dimensions" assertion is the backstop: the
/// resize Snapshot is built directly from the engine (ground truth) while the
/// subsequent Diff is built from the cached fields. If they diverge, both
/// assertions will catch it.
#[test]
fn cached_viewport_dims_survive_resize_and_match_diff_payload() {
    let (mut bridge, sink) = make_bridge(80, 24);

    // Resize to a distinct geometry.
    bridge.resize_and_emit(120, 40);

    // Capture the snapshot emitted by resize — this is the engine's ground
    // truth for the new dimensions.
    let msgs_after_resize = sink.messages();
    let resize_snapshot = match msgs_after_resize.last().expect("must have messages") {
        TerminalChannelMessage::Snapshot(snap) => snap.clone(),
        TerminalChannelMessage::Diff(other) => {
            panic!("Expected Snapshot from resize, got Diff {other:?}")
        }
    };
    assert_eq!(resize_snapshot.cols, 120);
    assert_eq!(resize_snapshot.rows, 40);

    // Now feed a byte — triggers feed_and_emit, which builds a GridDiff from
    // the cached cols/rows fields (NOT another snapshot call).
    let count_before = sink.messages().len();
    bridge.feed_and_emit(b"x");

    let msgs = sink.messages();
    let new_msgs = &msgs[count_before..];
    assert!(
        !new_msgs.is_empty(),
        "Expected a Diff after feed post-resize"
    );
    match &new_msgs[0] {
        TerminalChannelMessage::Diff(diff) => {
            // Cached fields must match the engine's snapshot dimensions.
            assert_eq!(
                diff.cols, resize_snapshot.cols,
                "Diff.cols (from cache) must equal resize Snapshot.cols (engine ground truth)"
            );
            assert_eq!(
                diff.rows, resize_snapshot.rows,
                "Diff.rows (from cache) must equal resize Snapshot.rows (engine ground truth)"
            );
        }
        TerminalChannelMessage::Snapshot(other) => {
            panic!("Expected Diff after feed, got Snapshot {other:?}");
        }
    }
}

// ─── Cycle-12: pty_write routing tests ───────────────────────────────────────

/// Feeding when `pty_writer` is None produces no panic — the bridge must degrade gracefully.
#[test]
fn pty_write_event_no_panic_without_writer() {
    let (mut bridge, _sink) = make_bridge(80, 24);
    // OSC foreground-color query; alacritty emits a ColorRequest for this.
    // With no pty_writer, the bridge must log and continue — no panic.
    bridge.feed_and_emit(b"\x1b]10;?\x07");
    // Reaching here = pass.
}

/// When a `pty_writer` is present and the engine emits a `ColorRequest`,
/// the bridge must write response bytes to it. Trigger OSC 10 foreground-color
/// query and assert SOMETHING was written (response bytes are non-empty).
#[test]
fn pty_write_event_routed_to_writer() {
    let (mut bridge, _sink, writer) = make_bridge_with_writer(80, 24);
    // OSC 10;?BEL — foreground color query.
    bridge.feed_and_emit(b"\x1b]10;?\x07");
    let written = writer.written();
    assert!(
        !written.is_empty(),
        "expected response bytes written to pty_writer after ColorRequest, got empty"
    );
}

/// The bytes written for a `ColorRequest` must contain the OSC escape
/// response shape (`\x1b]` prefix).
#[test]
fn color_request_response_shape_contains_osc_prefix() {
    let (mut bridge, _sink, writer) = make_bridge_with_writer(80, 24);
    // OSC 10;?BEL — foreground color query.
    bridge.feed_and_emit(b"\x1b]10;?\x07");
    let written = writer.written();
    // The response must start with ESC ] (OSC opener) — standard color response.
    assert!(
        written.starts_with(b"\x1b]"),
        "expected response to start with OSC ESC ] (\\x1b]), got: {written:?}"
    );
}

/// attach/cursor: initial snapshot contains a cursor position.
#[test]
fn attach_snapshot_contains_cursor_position() {
    let (bridge, sink) = make_bridge(80, 24);
    let msgs = sink.messages();
    match &msgs[0] {
        TerminalChannelMessage::Snapshot(snap) => {
            // Cursor row and col are within bounds.
            assert!(
                (snap.cursor.row as usize) < 24,
                "Cursor row {} must be < 24",
                snap.cursor.row
            );
            assert!(
                (snap.cursor.col as usize) < 80,
                "Cursor col {} must be < 80",
                snap.cursor.col
            );
        }
        TerminalChannelMessage::Diff(other) => {
            panic!("Expected Snapshot, got Diff {other:?}");
        }
    }
    drop(bridge);
}
