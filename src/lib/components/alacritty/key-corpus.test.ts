/**
 * key-corpus.test.ts
 *
 * Unit tests for the Cmd/Ctrl modifier key corpus.
 *
 * AC keyword: modifier (AC-4 longest content word ≥4 chars)
 */

import { describe, it, expect } from "vitest";
import { encodeCtrlKey, isIntercepted, lookupKey } from "./key-corpus";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function key(
  k: string,
  opts: {
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
    type?: string;
  } = {},
): KeyboardEvent {
  return {
    key: k,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    type: opts.type ?? "keydown",
  } as KeyboardEvent;
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ─── Ctrl+letter encoding corpus ─────────────────────────────────────────────

describe("Ctrl_modifier encoding corpus", () => {
  it("Ctrl_A_encodes_to_0x01", () => {
    expect(encodeCtrlKey("a")).toEqual(new Uint8Array([0x01]));
  });

  it("Ctrl_B_encodes_to_0x02", () => {
    expect(encodeCtrlKey("b")).toEqual(new Uint8Array([0x02]));
  });

  it("Ctrl_C_encodes_to_0x03 (SIGINT)", () => {
    expect(encodeCtrlKey("c")).toEqual(new Uint8Array([0x03]));
  });

  it("Ctrl_D_encodes_to_0x04 (EOF)", () => {
    expect(encodeCtrlKey("d")).toEqual(new Uint8Array([0x04]));
  });

  it("Ctrl_Z_encodes_to_0x1A (SIGTSTP)", () => {
    expect(encodeCtrlKey("z")).toEqual(new Uint8Array([0x1a]));
  });

  it("Ctrl_modifier_uppercase_A_encodes_same_as_lowercase", () => {
    expect(encodeCtrlKey("A")).toEqual(new Uint8Array([0x01]));
  });

  it("Ctrl_modifier_bracket_open_encodes_to_ESC", () => {
    expect(encodeCtrlKey("[")).toEqual(new Uint8Array([0x1b]));
  });

  it("Ctrl_modifier_backslash_encodes_to_FS", () => {
    expect(encodeCtrlKey("\\")).toEqual(new Uint8Array([0x1c]));
  });

  it("Ctrl_modifier_bracket_close_encodes_to_GS", () => {
    expect(encodeCtrlKey("]")).toEqual(new Uint8Array([0x1d]));
  });

  it("Ctrl_modifier_caret_encodes_to_RS", () => {
    expect(encodeCtrlKey("^")).toEqual(new Uint8Array([0x1e]));
  });

  it("Ctrl_modifier_underscore_encodes_to_US", () => {
    expect(encodeCtrlKey("_")).toEqual(new Uint8Array([0x1f]));
  });

  it("Ctrl_modifier_at_encodes_to_NUL", () => {
    expect(encodeCtrlKey("@")).toEqual(new Uint8Array([0x00]));
  });

  it("Ctrl_modifier_space_encodes_to_NUL", () => {
    expect(encodeCtrlKey(" ")).toEqual(new Uint8Array([0x00]));
  });

  it("Ctrl_modifier_unknown_returns_null", () => {
    expect(encodeCtrlKey("F1")).toBeNull();
  });
});

// ─── lookupKey: Ctrl combos via full event ────────────────────────────────────

describe("lookupKey Ctrl_modifier combos", () => {
  it("lookupKey Ctrl_A returns 0x01", () => {
    expect(lookupKey(key("a", { ctrlKey: true }))).toEqual(
      new Uint8Array([0x01]),
    );
  });

  it("lookupKey Ctrl_L returns 0x0C (clear screen)", () => {
    expect(lookupKey(key("l", { ctrlKey: true }))).toEqual(
      new Uint8Array([0x0c]),
    );
  });

  it("lookupKey Alt_a prefixes with ESC byte", () => {
    const result = lookupKey(key("a", { altKey: true }));
    expect(result).toEqual(new Uint8Array([0x1b, 0x61]));
  });

  it("lookupKey Ctrl_Alt_combo returns null (ambiguous, not handled)", () => {
    // Ctrl+Alt is not in the corpus — should fall through to null
    expect(lookupKey(key("x", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("lookupKey arrow Up with Ctrl modifier encodes CSI 1;5A", () => {
    const result = lookupKey(key("ArrowUp", { ctrlKey: true }));
    expect(result).toEqual(bytes("\x1b[1;5A"));
  });

  it("lookupKey arrow Left with Shift modifier encodes CSI 1;2D", () => {
    const result = lookupKey(key("ArrowLeft", { shiftKey: true }));
    expect(result).toEqual(bytes("\x1b[1;2D"));
  });

  it("lookupKey Shift_modifier_arrow right encodes CSI 1;2C", () => {
    const result = lookupKey(key("ArrowRight", { shiftKey: true }));
    expect(result).toEqual(bytes("\x1b[1;2C"));
  });

  it("lookupKey plain arrow Up encodes CSI A without modifier", () => {
    const result = lookupKey(key("ArrowUp"));
    expect(result).toEqual(new Uint8Array([0x1b, 0x5b, 0x41]));
  });

  it("lookupKey Enter encodes CR", () => {
    expect(lookupKey(key("Enter"))).toEqual(new Uint8Array([0x0d]));
  });

  it("lookupKey Backspace encodes DEL (0x7F)", () => {
    expect(lookupKey(key("Backspace"))).toEqual(new Uint8Array([0x7f]));
  });

  it("lookupKey F1 no modifier encodes SS3 P", () => {
    expect(lookupKey(key("F1"))).toEqual(bytes("\x1bOP"));
  });

  it("lookupKey F1 with Ctrl modifier encodes CSI 1;5P", () => {
    expect(lookupKey(key("F1", { ctrlKey: true }))).toEqual(bytes("\x1b[1;5P"));
  });

  it("lookupKey F5 no modifier encodes CSI 15~", () => {
    expect(lookupKey(key("F5"))).toEqual(bytes("\x1b[15~"));
  });

  it("lookupKey PageUp no modifier encodes CSI 5~", () => {
    expect(lookupKey(key("PageUp"))).toEqual(bytes("\x1b[5~"));
  });

  it("lookupKey printable key returns UTF-8 bytes", () => {
    const result = lookupKey(key("a"));
    expect(result).not.toBeNull();
    expect(Array.from(result!)).toEqual([0x61]);
  });

  it("lookupKey unknown modifier combo returns null", () => {
    expect(lookupKey(key("F24", { ctrlKey: true }))).toBeNull();
  });
});

// ─── isIntercepted: macOS Cmd shortcut interception ──────────────────────────

describe("isIntercepted modifier interception — macOS", () => {
  const mac = true;

  it("Cmd_K_intercepts_match_xterm_custom_handler on macOS", () => {
    expect(isIntercepted(key("k", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_N intercepts on macOS (new window)", () => {
    expect(isIntercepted(key("n", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_T intercepts on macOS (new tab)", () => {
    expect(isIntercepted(key("t", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_C intercepts on macOS (copy)", () => {
    expect(isIntercepted(key("c", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_V intercepts on macOS (paste)", () => {
    expect(isIntercepted(key("v", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_1 intercepts on macOS (tab index)", () => {
    expect(isIntercepted(key("1", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_equals intercepts on macOS (zoom in)", () => {
    expect(isIntercepted(key("=", { metaKey: true }), mac)).toBe(true);
  });

  it("Cmd_Shift_D intercepts on macOS (split pane)", () => {
    expect(
      isIntercepted(key("d", { metaKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Cmd_Shift_Enter intercepts on macOS", () => {
    expect(
      isIntercepted(key("Enter", { metaKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Cmd_Alt_ArrowLeft intercepts on macOS (navigate)", () => {
    expect(
      isIntercepted(key("ArrowLeft", { metaKey: true, altKey: true }), mac),
    ).toBe(true);
  });

  it("plain 'a' does NOT intercept on macOS", () => {
    expect(isIntercepted(key("a"), mac)).toBe(false);
  });

  it("Ctrl_A does NOT intercept on macOS (goes to PTY as 0x01)", () => {
    expect(isIntercepted(key("a", { ctrlKey: true }), mac)).toBe(false);
  });

  it("Ctrl_Tab intercepts on macOS (pane cycle)", () => {
    expect(isIntercepted(key("Tab", { ctrlKey: true }), mac)).toBe(true);
  });

  it("Ctrl_Shift_C intercepts on macOS (cross-platform copy)", () => {
    expect(
      isIntercepted(key("C", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("keyup event does NOT intercept", () => {
    expect(isIntercepted(key("k", { metaKey: true, type: "keyup" }), mac)).toBe(
      false,
    );
  });
});

// ─── isIntercepted: Linux Ctrl+Shift shortcut interception ───────────────────

describe("isIntercepted modifier interception — Linux", () => {
  const mac = false;

  it("Ctrl_Shift_T intercepts on Linux (new tab)", () => {
    expect(
      isIntercepted(key("T", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Ctrl_Shift_N intercepts on Linux (new window)", () => {
    expect(
      isIntercepted(key("N", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Ctrl_Shift_C intercepts on Linux (copy)", () => {
    expect(
      isIntercepted(key("C", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Ctrl_Shift_V intercepts on Linux (paste)", () => {
    expect(
      isIntercepted(key("V", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Ctrl_Shift_K intercepts on Linux", () => {
    expect(
      isIntercepted(key("K", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("plain 'a' does NOT intercept on Linux", () => {
    expect(isIntercepted(key("a"), mac)).toBe(false);
  });

  it("Ctrl_A alone does NOT intercept on Linux (goes to PTY)", () => {
    expect(isIntercepted(key("a", { ctrlKey: true }), mac)).toBe(false);
  });

  it("Ctrl_Tab intercepts on Linux", () => {
    expect(isIntercepted(key("Tab", { ctrlKey: true }), mac)).toBe(true);
  });

  it("Ctrl_Shift_0 intercepts on Linux", () => {
    expect(
      isIntercepted(key("0", { ctrlKey: true, shiftKey: true }), mac),
    ).toBe(true);
  });

  it("Cmd combos do NOT intercept on Linux", () => {
    expect(isIntercepted(key("t", { metaKey: true }), mac)).toBe(false);
  });
});
