//! Unit tests for the PTY <-> engine bridge (cycle-4).
//!
//! These tests drive `PtyBridge` directly without spawning a real PTY.
//! A `TestSink` records all emitted `TerminalChannelMessage` payloads so
//! assertions can inspect the emitted stream without a live Tauri Channel.

use super::pty_bridge::{MessageSink, PtyBridge, TerminalChannelMessage};

// ─── Test double ─────────────────────────────────────────────────────────────

/// A `MessageSink` implementation that accumulates emitted messages into a Vec.
#[derive(Default, Clone)]
struct TestSink {
    messages: std::sync::Arc<std::sync::Mutex<Vec<TerminalChannelMessage>>>,
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

// ─── Helper constructors ─────────────────────────────────────────────────────

fn make_bridge(cols: u16, rows: u16) -> (PtyBridge, TestSink) {
    let sink = TestSink::new();
    let bridge = PtyBridge::new(cols, rows, Box::new(sink.clone()));
    (bridge, sink)
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

    let mut bridge = PtyBridge::new(80, 24, Box::new(DroppedSink));
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
