//! Cross-cycle integration test (cycle-7).
//!
//! Verifies that the layers built in cycles 2–4 compose cleanly end-to-end:
//!
//! - cycle-2: `AlacrittyEngine` (feed → damage → `cursor_position`)
//! - cycle-3: IPC wire-format types (`GridDiff`, serde Serialize/Deserialize)
//! - cycle-4: `TerminalChannelMessage` / `PtyBridge` (serde Serialize, channel
//!   payload shape with `kind`/`value` tags)
//!
//! This test does NOT spawn a real PTY or a live Tauri app. It drives
//! `AlacrittyEngine::feed()` directly, extracts damage, builds the IPC
//! payload, and asserts the full pipeline from engine bytes to wire JSON.

use crate::terminal_engine::alacritty::AlacrittyEngine;
use crate::terminal_engine::ipc::GridDiff;
use crate::terminal_engine::pty_bridge::TerminalChannelMessage;
use crate::terminal_engine::trait_def::TerminalEngine;
use crate::terminal_engine::types::GridSnapshot;

/// End-to-end integration test: engine feed → damage → IPC types → serialization.
///
/// Covers AC-7 ("Rust tests cover state-engine integration (feed → damage →
/// snapshot, cursor moves) and IPC serialization (snapshot/diff round-trip)").
/// Serves as the closest automated proxy for AC-6's interactive-shell pipeline.
///
/// Pipeline validated:
/// 1. `AlacrittyEngine::feed()` ingests raw bytes (cycle-2 trait).
/// 2. `AlacrittyEngine::damage()` returns non-empty `DirtyRect`s (cycle-2).
/// 3. `AlacrittyEngine::cursor_position()` reflects the bytes written (cycle-2).
/// 4. `GridDiff` is constructed from engine damage + cursor (cycle-3 type).
/// 5. `TerminalChannelMessage::Diff` wraps `GridDiff` (cycle-4 enum).
/// 6. `serde_json::to_string` produces tagged JSON with `kind`/`value` fields (cycle-4
///    `#[serde(tag = "kind", content = "value")]`).
/// 7. The payload is decoded back to `GridDiff` via `serde_json::from_str` (cycle-3
///    `Deserialize`), confirming round-trip fidelity for the cursor and dirty span.
/// 8. `GridSnapshot` round-trip: engine snapshot → serde encode → decode →
///    same grid dimensions and cursor.
#[test]
fn engine_to_wire_format_integration_pipeline_serializes_damage_and_cursor() {
    // ── 1. Construct engine (cycle-2) ────────────────────────────────────────
    let mut engine = AlacrittyEngine::new(80, 24);

    // Consume the initial full-damage produced at construction so the next
    // damage() call reflects only the bytes we feed below.
    engine.reset_damage();

    // ── 2. Feed bytes — drives the VT parser (cycle-2 trait) ────────────────
    engine.feed(b"hello world\r\n");

    // ── 3. Extract damage (cycle-2) ──────────────────────────────────────────
    let damage = engine.damage();
    assert!(
        !damage.is_empty(),
        "damage() must return at least one DirtyRect after feeding bytes"
    );

    // At least one dirty rect must touch row 0, covering the first column
    // where 'h' was written.
    let first_row_covered = damage.iter().any(|r| r.row == 0 && r.col_start == 0);
    assert!(
        first_row_covered,
        "expected a DirtyRect anchored at row=0, col_start=0; got: {damage:?}"
    );

    // ── 4. Cursor position (cycle-2) ─────────────────────────────────────────
    // "hello world\r\n" advances 11 chars then does CR+LF → cursor at row 1, col 0.
    let cursor = engine.cursor_position();
    assert_eq!(cursor.row, 1, "cursor row after CR+LF must be 1");
    assert_eq!(cursor.col, 0, "cursor col after LF must be 0");
    assert!(cursor.visible, "cursor should be visible by default");

    // ── 5. Build GridDiff (cycle-3 IPC type) ────────────────────────────────
    let diff = GridDiff {
        rows: 24,
        cols: 80,
        dirty: damage.clone(),
        cursor,
    };

    // ── 6. Wrap in TerminalChannelMessage (cycle-4) ──────────────────────────
    let msg = TerminalChannelMessage::Diff(diff.clone());

    // ── 7. Serialize to JSON (cycle-4 serde tag shape) ───────────────────────
    let encoded = serde_json::to_string(&msg).expect("TerminalChannelMessage::Diff must serialize");

    // The cycle-4 enum uses `#[serde(tag = "kind", content = "value")]` with
    // `rename_all = "lowercase"`, so the JSON must contain `"kind":"diff"` and
    // the `"value"` wrapper.
    assert!(
        encoded.contains("\"kind\":\"diff\""),
        "encoded JSON must contain '\"kind\":\"diff\"'; got: {encoded}"
    );
    assert!(
        encoded.contains("\"value\""),
        "encoded JSON must contain '\"value\"' content key; got: {encoded}"
    );

    // ── 8. Round-trip GridDiff (cycle-3 Deserialize) ─────────────────────────
    // TerminalChannelMessage does not derive Deserialize (intentional — the
    // Tauri channel is write-only from Rust's perspective). We decode the
    // inner GridDiff payload directly. The wire JSON is:
    //   {"kind":"diff","value":{...GridDiff fields...}}
    // Extract the "value" object and decode as GridDiff.
    let json_val: serde_json::Value =
        serde_json::from_str(&encoded).expect("TerminalChannelMessage JSON must be valid");
    let diff_val = json_val
        .get("value")
        .expect("encoded JSON must have 'value' key");
    let decoded_diff: GridDiff =
        serde_json::from_value(diff_val.clone()).expect("GridDiff must deserialize from 'value'");

    // Verify the decoded diff preserves the cursor position we fed.
    assert_eq!(
        decoded_diff.cursor.row, cursor.row,
        "decoded cursor row must match"
    );
    assert_eq!(
        decoded_diff.cursor.col, cursor.col,
        "decoded cursor col must match"
    );
    assert_eq!(
        decoded_diff.cursor.visible, cursor.visible,
        "decoded cursor visibility must match"
    );

    // Verify grid dimensions survive the round-trip.
    assert_eq!(decoded_diff.rows, 24, "decoded GridDiff rows must be 24");
    assert_eq!(decoded_diff.cols, 80, "decoded GridDiff cols must be 80");

    // Verify that the dirty rects survive the round-trip (at least one present).
    assert!(
        !decoded_diff.dirty.is_empty(),
        "decoded GridDiff must contain at least one DirtyRect"
    );

    // Verify that the first dirty rect's first cell contains a character from
    // "hello world" — confirms the engine actually wrote visible content.
    let first_rect = &decoded_diff.dirty[0];
    let has_visible_char = first_rect
        .cells
        .iter()
        .any(|c| !c.ch.trim().is_empty() && c.ch != " ");
    assert!(
        has_visible_char,
        "at least one cell in the first dirty rect must contain a non-space character; \
         rect: {first_rect:?}"
    );

    // ── 9. GridSnapshot round-trip (cycle-3 Serialize+Deserialize) ───────────
    // Feed more content to advance cursor, then snapshot and round-trip.
    engine.feed(b"echo hello");
    let snapshot: GridSnapshot = engine.snapshot();
    assert_eq!(snapshot.cols, 80, "snapshot cols must be 80");
    assert_eq!(snapshot.rows, 24, "snapshot rows must be 24");
    assert_eq!(
        snapshot.rows_data.len(),
        24,
        "snapshot rows_data.len must equal rows"
    );

    // Wrap in TerminalChannelMessage::Snapshot and check the JSON kind tag.
    let snap_msg = TerminalChannelMessage::Snapshot(snapshot.clone());
    let snap_encoded =
        serde_json::to_string(&snap_msg).expect("TerminalChannelMessage::Snapshot must serialize");
    assert!(
        snap_encoded.contains("\"kind\":\"snapshot\""),
        "snapshot message JSON must contain '\"kind\":\"snapshot\"'; got: {snap_encoded}"
    );

    // Round-trip the snapshot payload via GridSnapshot's Deserialize.
    let snap_val: serde_json::Value =
        serde_json::from_str(&snap_encoded).expect("snapshot JSON must be valid");
    let snap_inner = snap_val
        .get("value")
        .expect("snapshot JSON must have 'value' key");
    let decoded_snap: GridSnapshot =
        serde_json::from_value(snap_inner.clone()).expect("GridSnapshot must deserialize");

    assert_eq!(decoded_snap.cols, 80, "decoded snapshot cols must be 80");
    assert_eq!(decoded_snap.rows, 24, "decoded snapshot rows must be 24");
    assert_eq!(
        decoded_snap.rows_data.len(),
        24,
        "decoded snapshot rows_data.len must equal rows"
    );
    // Cursor must be within grid bounds after feeding "echo hello".
    assert!(
        (decoded_snap.cursor.row as usize) < 24,
        "decoded snapshot cursor row {} must be < 24",
        decoded_snap.cursor.row
    );
    assert!(
        (decoded_snap.cursor.col as usize) < 80,
        "decoded snapshot cursor col {} must be < 80",
        decoded_snap.cursor.col
    );
}
