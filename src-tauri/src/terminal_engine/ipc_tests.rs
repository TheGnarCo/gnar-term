//! Serde round-trip tests for the terminal IPC wire-format types.
//!
//! These tests verify that `GridSnapshot` and `GridDiff` survive a JSON
//! encode → decode round-trip with structural equality, and that specific
//! `snake_case` JSON keys are emitted to lock the on-wire shape.

use crate::terminal_engine::ipc::{GridDiff, GridSnapshot};
use crate::terminal_engine::types::{
    Cell, ColorIndex, CursorPos, CursorShapeTag, DirtyRect, RowData, ATTR_BOLD, ATTR_UNDERLINE,
};

// ─── GridSnapshot round-trips ─────────────────────────────────────────────────

/// Full 3×2 snapshot with mixed Indexed/Rgb colors and bold|underline attrs.
#[test]
fn gridsnapshot_serde_roundtrip_preserves_cells_and_cursor() {
    let snapshot = GridSnapshot {
        cols: 3,
        rows: 2,
        cursor: CursorPos {
            row: 0,
            col: 1,
            visible: true,
            shape: CursorShapeTag::Block,
        },
        rows_data: vec![
            RowData {
                cells: vec![
                    Cell {
                        ch: "A".to_string(),
                        fg: ColorIndex::Indexed(7),
                        bg: ColorIndex::Rgb(20, 30, 40),
                        attrs: ATTR_BOLD | ATTR_UNDERLINE,
                    },
                    Cell {
                        ch: " ".to_string(),
                        fg: ColorIndex::Indexed(0),
                        bg: ColorIndex::Indexed(0),
                        attrs: 0,
                    },
                    Cell {
                        ch: "é".to_string(),
                        fg: ColorIndex::Rgb(255, 128, 0),
                        bg: ColorIndex::Indexed(15),
                        attrs: 0,
                    },
                ],
            },
            RowData {
                cells: vec![
                    Cell {
                        ch: " ".to_string(),
                        fg: ColorIndex::Indexed(7),
                        bg: ColorIndex::Indexed(0),
                        attrs: 0,
                    },
                    Cell {
                        ch: "B".to_string(),
                        fg: ColorIndex::Indexed(2),
                        bg: ColorIndex::Indexed(0),
                        attrs: ATTR_BOLD,
                    },
                    Cell {
                        ch: " ".to_string(),
                        fg: ColorIndex::Indexed(7),
                        bg: ColorIndex::Indexed(0),
                        attrs: 0,
                    },
                ],
            },
        ],
    };

    let json = serde_json::to_string(&snapshot).expect("serialize GridSnapshot");
    let decoded: GridSnapshot = serde_json::from_str(&json).expect("deserialize GridSnapshot");

    assert_eq!(decoded.cols, snapshot.cols);
    assert_eq!(decoded.rows, snapshot.rows);
    assert_eq!(decoded.cursor, snapshot.cursor);
    assert_eq!(decoded.rows_data.len(), snapshot.rows_data.len());
    for (r, (got, want)) in decoded
        .rows_data
        .iter()
        .zip(snapshot.rows_data.iter())
        .enumerate()
    {
        assert_eq!(got.cells.len(), want.cells.len(), "row {r} cell count");
        for (c, (gc, wc)) in got.cells.iter().zip(want.cells.iter()).enumerate() {
            assert_eq!(gc, wc, "row {r} col {c}");
        }
    }
}

// ─── GridDiff round-trips ─────────────────────────────────────────────────────

/// `GridDiff` with an empty dirty list (resize-only notification).
#[test]
fn griddiff_serde_roundtrip_empty_dirty() {
    let diff = GridDiff {
        rows: 24,
        cols: 80,
        dirty: vec![],
        cursor: CursorPos {
            row: 0,
            col: 0,
            visible: true,
            shape: CursorShapeTag::Block,
        },
    };

    let json = serde_json::to_string(&diff).expect("serialize GridDiff");
    let decoded: GridDiff = serde_json::from_str(&json).expect("deserialize GridDiff");

    assert_eq!(decoded.rows, diff.rows);
    assert_eq!(decoded.cols, diff.cols);
    assert!(decoded.dirty.is_empty());
    assert_eq!(decoded.cursor, diff.cursor);
}

/// `GridDiff` with a single `DirtyRect` spanning a partial row.
#[test]
fn griddiff_serde_roundtrip_one_dirty_rect() {
    let diff = GridDiff {
        rows: 24,
        cols: 80,
        dirty: vec![DirtyRect {
            row: 5,
            col_start: 10,
            col_end: 15,
            cells: vec![
                Cell {
                    ch: "X".to_string(),
                    fg: ColorIndex::Indexed(1),
                    bg: ColorIndex::Indexed(0),
                    attrs: 0,
                },
                Cell {
                    ch: "Y".to_string(),
                    fg: ColorIndex::Indexed(2),
                    bg: ColorIndex::Indexed(0),
                    attrs: 0,
                },
                Cell {
                    ch: "Z".to_string(),
                    fg: ColorIndex::Indexed(3),
                    bg: ColorIndex::Indexed(0),
                    attrs: 0,
                },
                Cell {
                    ch: " ".to_string(),
                    fg: ColorIndex::Indexed(7),
                    bg: ColorIndex::Indexed(0),
                    attrs: 0,
                },
                Cell {
                    ch: " ".to_string(),
                    fg: ColorIndex::Indexed(7),
                    bg: ColorIndex::Indexed(0),
                    attrs: 0,
                },
            ],
        }],
        cursor: CursorPos {
            row: 5,
            col: 15,
            visible: true,
            shape: CursorShapeTag::Block,
        },
    };

    let json = serde_json::to_string(&diff).expect("serialize GridDiff one rect");
    let decoded: GridDiff = serde_json::from_str(&json).expect("deserialize GridDiff one rect");

    assert_eq!(decoded.dirty.len(), 1);
    let rect = &decoded.dirty[0];
    assert_eq!(rect.row, 5);
    assert_eq!(rect.col_start, 10);
    assert_eq!(rect.col_end, 15);
    assert_eq!(rect.cells.len(), 5);
    assert_eq!(rect.cells[0].ch, "X");
    assert_eq!(decoded.cursor, diff.cursor);
}

/// `GridDiff` with multiple `DirtyRect`s across different rows.
#[test]
fn griddiff_serde_roundtrip_multiple_rects_across_rows() {
    let diff = GridDiff {
        rows: 24,
        cols: 80,
        dirty: vec![
            DirtyRect {
                row: 0,
                col_start: 0,
                col_end: 3,
                cells: vec![
                    Cell {
                        ch: "a".to_string(),
                        fg: ColorIndex::Indexed(7),
                        bg: ColorIndex::Indexed(0),
                        attrs: 0,
                    },
                    Cell {
                        ch: "b".to_string(),
                        fg: ColorIndex::Indexed(7),
                        bg: ColorIndex::Indexed(0),
                        attrs: 0,
                    },
                    Cell {
                        ch: "c".to_string(),
                        fg: ColorIndex::Indexed(7),
                        bg: ColorIndex::Indexed(0),
                        attrs: 0,
                    },
                ],
            },
            DirtyRect {
                row: 2,
                col_start: 5,
                col_end: 7,
                cells: vec![
                    Cell {
                        ch: "d".to_string(),
                        fg: ColorIndex::Rgb(100, 200, 50),
                        bg: ColorIndex::Indexed(0),
                        attrs: ATTR_BOLD,
                    },
                    Cell {
                        ch: "e".to_string(),
                        fg: ColorIndex::Rgb(100, 200, 50),
                        bg: ColorIndex::Indexed(0),
                        attrs: ATTR_BOLD,
                    },
                ],
            },
            DirtyRect {
                row: 10,
                col_start: 20,
                col_end: 21,
                cells: vec![Cell {
                    ch: "→".to_string(),
                    fg: ColorIndex::Indexed(4),
                    bg: ColorIndex::Indexed(0),
                    attrs: 0,
                }],
            },
        ],
        cursor: CursorPos {
            row: 10,
            col: 21,
            visible: false,
            shape: CursorShapeTag::Block,
        },
    };

    let json = serde_json::to_string(&diff).expect("serialize multi-rect GridDiff");
    let decoded: GridDiff = serde_json::from_str(&json).expect("deserialize multi-rect GridDiff");

    assert_eq!(decoded.dirty.len(), 3);
    assert_eq!(decoded.dirty[0].row, 0);
    assert_eq!(decoded.dirty[1].row, 2);
    assert_eq!(decoded.dirty[2].row, 10);
    assert_eq!(decoded.dirty[2].cells[0].ch, "→");
    assert!(!decoded.cursor.visible);
}

// ─── Cycle-12: CursorPos.shape wire tests ─────────────────────────────────────

/// `CursorPos` with a Block shape survives JSON encode → decode.
/// The `shape` field must be present in the wire JSON.
#[test]
fn cursor_shape_wire_roundtrip_block() {
    let cursor = CursorPos {
        row: 1,
        col: 2,
        visible: true,
        shape: CursorShapeTag::Block,
    };
    let json = serde_json::to_string(&cursor).expect("serialize CursorPos");
    // The wire JSON must include the shape discriminant.
    assert!(
        json.contains("\"kind\""),
        "expected shape 'kind' discriminant in CursorPos JSON, got: {json}"
    );
    assert!(
        json.contains("\"block\""),
        "expected 'block' shape value in CursorPos JSON, got: {json}"
    );
    let decoded: CursorPos = serde_json::from_str(&json).expect("deserialize CursorPos");
    assert_eq!(decoded.shape, CursorShapeTag::Block);
    assert_eq!(decoded.row, 1);
    assert_eq!(decoded.col, 2);
}

/// Beam shape survives round-trip.
#[test]
fn cursor_shape_wire_roundtrip_beam() {
    let cursor = CursorPos {
        row: 0,
        col: 0,
        visible: true,
        shape: CursorShapeTag::Beam,
    };
    let json = serde_json::to_string(&cursor).expect("serialize CursorPos beam");
    assert!(
        json.contains("\"beam\""),
        "expected 'beam' in CursorPos JSON, got: {json}"
    );
    let decoded: CursorPos = serde_json::from_str(&json).expect("deserialize CursorPos beam");
    assert_eq!(decoded.shape, CursorShapeTag::Beam);
}

/// Cursor visibility survives round-trip when `visible = false`.
#[test]
fn cursor_visibility_serde_roundtrip_hidden_cursor() {
    let diff = GridDiff {
        rows: 10,
        cols: 40,
        dirty: vec![],
        cursor: CursorPos {
            row: 3,
            col: 7,
            visible: false,
            shape: CursorShapeTag::Block,
        },
    };

    let json = serde_json::to_string(&diff).expect("serialize hidden cursor");
    let decoded: GridDiff = serde_json::from_str(&json).expect("deserialize hidden cursor");

    assert!(!decoded.cursor.visible);
    assert_eq!(decoded.cursor.row, 3);
    assert_eq!(decoded.cursor.col, 7);
}

// ─── ColorIndex wire-contract: Rgb serialises as array ───────────────────────

/// Asserts that `ColorIndex::Rgb(255, 128, 0)` serialises to JSON containing
/// `"kind":"Rgb"` and `"value":[255,128,0]` (an array, not an object).
/// This locks the TypeScript discriminated-union contract: the TS side
/// pattern-matches on `color.kind === "Rgb"` and destructures
/// `const [r, g, b] = color.value`, so an object shape would silently break it.
#[test]
fn wire_format_rgb_color_index_serialises_as_array() {
    let color = ColorIndex::Rgb(255, 128, 0);
    let json = serde_json::to_string(&color).expect("serialize ColorIndex::Rgb");
    assert!(
        json.contains("\"kind\":\"Rgb\""),
        "expected '\"kind\":\"Rgb\"' in ColorIndex JSON, got: {json}"
    );
    assert!(
        json.contains("\"value\":[255,128,0]"),
        "expected '\"value\":[255,128,0]' (array) in ColorIndex JSON, got: {json}"
    );
}

// ─── Cycle-14: NamedSlot wire format tests ────────────────────────────────────

use crate::terminal_engine::types::NamedSlot;

/// `ColorIndex::Named(NamedSlot::Foreground)` must serialise to
/// `{"kind":"Named","value":"foreground"}` — confirming the adjacently-tagged
/// serde representation and the `rename_all = "snake_case"` on `NamedSlot`.
#[test]
fn wire_format_named_color_serialises_as_named_slot() {
    let color = ColorIndex::Named(NamedSlot::Foreground);
    let json = serde_json::to_string(&color).expect("serialize ColorIndex::Named(Foreground)");
    assert!(
        json.contains("\"kind\":\"Named\""),
        "expected '\"kind\":\"Named\"' in ColorIndex JSON, got: {json}"
    );
    assert!(
        json.contains("\"value\":\"foreground\""),
        "expected '\"value\":\"foreground\"' in ColorIndex JSON, got: {json}"
    );
}

/// All 14 `NamedSlot` variants must survive a JSON round-trip with structural equality.
#[test]
fn named_slot_all_variants_serde_roundtrip() {
    let variants = [
        NamedSlot::Foreground,
        NamedSlot::Background,
        NamedSlot::Cursor,
        NamedSlot::BrightForeground,
        NamedSlot::DimForeground,
        NamedSlot::DimBlack,
        NamedSlot::DimRed,
        NamedSlot::DimGreen,
        NamedSlot::DimYellow,
        NamedSlot::DimBlue,
        NamedSlot::DimMagenta,
        NamedSlot::DimCyan,
        NamedSlot::DimWhite,
    ];
    for slot in variants {
        let color = ColorIndex::Named(slot);
        let json = serde_json::to_string(&color)
            .unwrap_or_else(|_| panic!("failed to serialize {slot:?}"));
        let decoded: ColorIndex = serde_json::from_str(&json)
            .unwrap_or_else(|_| panic!("failed to deserialize {slot:?}: {json}"));
        assert_eq!(
            decoded, color,
            "round-trip mismatch for {slot:?}: json={json}"
        );
    }
}

/// `NamedSlot::Background` must serialise as `"background"` (`snake_case`).
#[test]
fn wire_format_named_slot_background_is_snake_case() {
    let color = ColorIndex::Named(NamedSlot::Background);
    let json = serde_json::to_string(&color).expect("serialize Named(Background)");
    assert!(
        json.contains("\"background\""),
        "expected 'background' (snake_case) in JSON, got: {json}"
    );
}

/// `NamedSlot::BrightForeground` must serialise as `"bright_foreground"`.
#[test]
fn wire_format_named_slot_bright_foreground_is_snake_case() {
    let color = ColorIndex::Named(NamedSlot::BrightForeground);
    let json = serde_json::to_string(&color).expect("serialize Named(BrightForeground)");
    assert!(
        json.contains("\"bright_foreground\""),
        "expected 'bright_foreground' in JSON, got: {json}"
    );
}

/// `NamedSlot::DimBlack` must serialise as `"dim_black"`.
#[test]
fn wire_format_named_slot_dim_black_is_snake_case() {
    let color = ColorIndex::Named(NamedSlot::DimBlack);
    let json = serde_json::to_string(&color).expect("serialize Named(DimBlack)");
    assert!(
        json.contains("\"dim_black\""),
        "expected 'dim_black' in JSON, got: {json}"
    );
}

/// `ColorIndex::Named` must survive a `GridSnapshot` round-trip end-to-end.
/// This validates that the extended enum is compatible with nested serde derivation.
#[test]
fn named_color_in_cell_roundtrips_through_gridsnapshot() {
    let snapshot = crate::terminal_engine::ipc::GridSnapshot {
        cols: 1,
        rows: 1,
        cursor: CursorPos {
            row: 0,
            col: 0,
            visible: true,
            shape: CursorShapeTag::Block,
        },
        rows_data: vec![RowData {
            cells: vec![Cell {
                ch: "X".to_string(),
                fg: ColorIndex::Named(NamedSlot::Foreground),
                bg: ColorIndex::Named(NamedSlot::Background),
                attrs: 0,
            }],
        }],
    };

    let json = serde_json::to_string(&snapshot).expect("serialize snapshot with Named colors");
    let decoded: crate::terminal_engine::ipc::GridSnapshot =
        serde_json::from_str(&json).expect("deserialize snapshot with Named colors");

    assert_eq!(
        decoded.rows_data[0].cells[0].fg,
        ColorIndex::Named(NamedSlot::Foreground)
    );
    assert_eq!(
        decoded.rows_data[0].cells[0].bg,
        ColorIndex::Named(NamedSlot::Background)
    );
}

// ─── Wire-contract key-shape tests ────────────────────────────────────────────

/// Asserts specific `snake_case` JSON field names to lock the on-wire shape
/// so that TS consumers don't silently break on field renames.
#[test]
fn wire_contract_json_keys_are_snake_case() {
    let snapshot = GridSnapshot {
        cols: 1,
        rows: 1,
        cursor: CursorPos {
            row: 0,
            col: 0,
            visible: true,
            shape: CursorShapeTag::Block,
        },
        rows_data: vec![RowData {
            cells: vec![Cell {
                ch: " ".to_string(),
                fg: ColorIndex::Indexed(7),
                bg: ColorIndex::Indexed(0),
                attrs: 0,
            }],
        }],
    };

    let json = serde_json::to_string(&snapshot).expect("serialize for key check");
    assert!(
        json.contains("\"rows_data\""),
        "expected 'rows_data' key in JSON, got: {json}"
    );
    assert!(
        json.contains("\"cursor\""),
        "expected 'cursor' key in JSON, got: {json}"
    );

    let diff = GridDiff {
        rows: 1,
        cols: 1,
        dirty: vec![DirtyRect {
            row: 0,
            col_start: 0,
            col_end: 1,
            cells: vec![Cell {
                ch: " ".to_string(),
                fg: ColorIndex::Indexed(0),
                bg: ColorIndex::Indexed(0),
                attrs: 0,
            }],
        }],
        cursor: CursorPos {
            row: 0,
            col: 0,
            visible: true,
            shape: CursorShapeTag::Block,
        },
    };

    let diff_json = serde_json::to_string(&diff).expect("serialize diff for key check");
    assert!(
        diff_json.contains("\"col_start\""),
        "expected 'col_start' key in JSON, got: {diff_json}"
    );
    assert!(
        diff_json.contains("\"col_end\""),
        "expected 'col_end' key in JSON, got: {diff_json}"
    );

    // ColorIndex discriminated union: check for "kind" and "value" tags
    let indexed_cell = Cell {
        ch: "X".to_string(),
        fg: ColorIndex::Indexed(5),
        bg: ColorIndex::Rgb(1, 2, 3),
        attrs: 0,
    };
    let cell_json = serde_json::to_string(&indexed_cell).expect("serialize cell for color check");
    assert!(
        cell_json.contains("\"kind\""),
        "expected 'kind' discriminant in ColorIndex JSON, got: {cell_json}"
    );
    assert!(
        cell_json.contains("\"value\""),
        "expected 'value' field in ColorIndex JSON, got: {cell_json}"
    );
}
