/**
 * alacritty-key-encoder.test.ts
 *
 * Unit tests for the keyboard event → PTY byte sequence encoder.
 *
 * AC keywords: encode, keyboard
 */

import { describe, it, expect } from "vitest";
import { encodeKey } from "./alacritty-key-encoder";

/**
 * Minimal KeyboardEvent-like object for testing. Only `key` is needed
 * by encodeKey — we don't need a full DOM environment.
 */
function key(k: string): KeyboardEvent {
  return { key: k } as KeyboardEvent;
}

function keyWithMods(
  k: string,
  opts: {
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
  } = {},
): KeyboardEvent {
  return {
    key: k,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
  } as KeyboardEvent;
}

describe("encodeKey (keyboard encoder)", () => {
  // ── Printable ASCII ────────────────────────────────────────────────────────

  it("encode printable ASCII: 'a' returns 'a'", () => {
    expect(encodeKey(key("a"))).toBe("a");
  });

  it("encode printable ASCII: 'Z' returns 'Z'", () => {
    expect(encodeKey(key("Z"))).toBe("Z");
  });

  it("encode printable ASCII: '0' returns '0'", () => {
    expect(encodeKey(key("0"))).toBe("0");
  });

  it("encode printable ASCII: ' ' (space) returns ' '", () => {
    expect(encodeKey(key(" "))).toBe(" ");
  });

  it("encode printable ASCII: '!' returns '!'", () => {
    expect(encodeKey(key("!"))).toBe("!");
  });

  // ── Special keys ──────────────────────────────────────────────────────────

  it("encode Enter returns carriage return (\\r)", () => {
    expect(encodeKey(key("Enter"))).toBe("\r");
  });

  it("encode Backspace returns DEL (\\x7f)", () => {
    expect(encodeKey(key("Backspace"))).toBe("\x7f");
  });

  it("encode Tab returns horizontal tab (\\t)", () => {
    expect(encodeKey(key("Tab"))).toBe("\t");
  });

  it("encode Escape returns ESC (\\x1b)", () => {
    expect(encodeKey(key("Escape"))).toBe("\x1b");
  });

  // ── Arrow keys (CSI sequences) ────────────────────────────────────────────

  it("encode ArrowUp returns CSI A (\\x1b[A)", () => {
    expect(encodeKey(key("ArrowUp"))).toBe("\x1b[A");
  });

  it("encode ArrowDown returns CSI B (\\x1b[B)", () => {
    expect(encodeKey(key("ArrowDown"))).toBe("\x1b[B");
  });

  it("encode ArrowRight returns CSI C (\\x1b[C)", () => {
    expect(encodeKey(key("ArrowRight"))).toBe("\x1b[C");
  });

  it("encode ArrowLeft returns CSI D (\\x1b[D)", () => {
    expect(encodeKey(key("ArrowLeft"))).toBe("\x1b[D");
  });

  // ── Function keys (Phase 2) ───────────────────────────────────────────────

  it("function_key F1 returns SS3 P (\\x1bOP)", () => {
    expect(encodeKey(key("F1"))).toBe("\x1bOP");
  });

  it("function_key F2 returns SS3 Q (\\x1bOQ)", () => {
    expect(encodeKey(key("F2"))).toBe("\x1bOQ");
  });

  it("function_key F3 returns SS3 R (\\x1bOR)", () => {
    expect(encodeKey(key("F3"))).toBe("\x1bOR");
  });

  it("function_key F4 returns SS3 S (\\x1bOS)", () => {
    expect(encodeKey(key("F4"))).toBe("\x1bOS");
  });

  it("function_key F5 returns CSI 15~ (\\x1b[15~)", () => {
    expect(encodeKey(key("F5"))).toBe("\x1b[15~");
  });

  it("function_key F6 returns CSI 17~ (\\x1b[17~)", () => {
    expect(encodeKey(key("F6"))).toBe("\x1b[17~");
  });

  it("function_key F7 returns CSI 18~ (\\x1b[18~)", () => {
    expect(encodeKey(key("F7"))).toBe("\x1b[18~");
  });

  it("function_key F8 returns CSI 19~ (\\x1b[19~)", () => {
    expect(encodeKey(key("F8"))).toBe("\x1b[19~");
  });

  it("function_key F9 returns CSI 20~ (\\x1b[20~)", () => {
    expect(encodeKey(key("F9"))).toBe("\x1b[20~");
  });

  it("function_key F10 returns CSI 21~ (\\x1b[21~)", () => {
    expect(encodeKey(key("F10"))).toBe("\x1b[21~");
  });

  it("function_key F11 returns CSI 23~ (\\x1b[23~)", () => {
    expect(encodeKey(key("F11"))).toBe("\x1b[23~");
  });

  it("function_key F12 returns CSI 24~ (\\x1b[24~)", () => {
    expect(encodeKey(key("F12"))).toBe("\x1b[24~");
  });

  // ── Home / End / PageUp / PageDown / Insert / Delete ─────────────────────

  it("function_key Home returns SS3 H (\\x1bOH)", () => {
    expect(encodeKey(key("Home"))).toBe("\x1bOH");
  });

  it("function_key End returns SS3 F (\\x1bOF)", () => {
    expect(encodeKey(key("End"))).toBe("\x1bOF");
  });

  it("function_key PageUp returns CSI 5~ (\\x1b[5~)", () => {
    expect(encodeKey(key("PageUp"))).toBe("\x1b[5~");
  });

  it("function_key PageDown returns CSI 6~ (\\x1b[6~)", () => {
    expect(encodeKey(key("PageDown"))).toBe("\x1b[6~");
  });

  it("function_key Insert returns CSI 2~ (\\x1b[2~)", () => {
    expect(encodeKey(key("Insert"))).toBe("\x1b[2~");
  });

  it("function_key Delete returns CSI 3~ (\\x1b[3~)", () => {
    expect(encodeKey(key("Delete"))).toBe("\x1b[3~");
  });

  // ── Ctrl+letter combos ────────────────────────────────────────────────────

  it("modifier Ctrl+a returns \\x01", () => {
    expect(encodeKey(keyWithMods("a", { ctrlKey: true }))).toBe("\x01");
  });

  it("modifier Ctrl+z returns \\x1a", () => {
    expect(encodeKey(keyWithMods("z", { ctrlKey: true }))).toBe("\x1a");
  });

  it("modifier Ctrl+A (uppercase) returns \\x01 (case-insensitive)", () => {
    expect(encodeKey(keyWithMods("A", { ctrlKey: true }))).toBe("\x01");
  });

  it("modifier Ctrl+[ returns ESC (\\x1b)", () => {
    expect(encodeKey(keyWithMods("[", { ctrlKey: true }))).toBe("\x1b");
  });

  it("modifier Ctrl+\\ returns \\x1c", () => {
    expect(encodeKey(keyWithMods("\\", { ctrlKey: true }))).toBe("\x1c");
  });

  it("modifier Ctrl+] returns \\x1d", () => {
    expect(encodeKey(keyWithMods("]", { ctrlKey: true }))).toBe("\x1d");
  });

  it("modifier Ctrl+^ returns \\x1e", () => {
    expect(encodeKey(keyWithMods("^", { ctrlKey: true }))).toBe("\x1e");
  });

  it("modifier Ctrl+_ returns \\x1f", () => {
    expect(encodeKey(keyWithMods("_", { ctrlKey: true }))).toBe("\x1f");
  });

  it("modifier Ctrl+@ returns \\x00 (null)", () => {
    expect(encodeKey(keyWithMods("@", { ctrlKey: true }))).toBe("\x00");
  });

  // ── Alt-prefix for printable keys ─────────────────────────────────────────

  it("modifier Alt+a returns ESC prefixed 'a' (\\x1ba)", () => {
    expect(encodeKey(keyWithMods("a", { altKey: true }))).toBe("\x1ba");
  });

  it("modifier Alt+z returns ESC prefixed 'z' (\\x1bz)", () => {
    expect(encodeKey(keyWithMods("z", { altKey: true }))).toBe("\x1bz");
  });

  // ── Modifier-encoded arrow keys ───────────────────────────────────────────

  it("modifier Ctrl+ArrowUp returns \\x1b[1;5A", () => {
    expect(encodeKey(keyWithMods("ArrowUp", { ctrlKey: true }))).toBe(
      "\x1b[1;5A",
    );
  });

  it("modifier Ctrl+ArrowDown returns \\x1b[1;5B", () => {
    expect(encodeKey(keyWithMods("ArrowDown", { ctrlKey: true }))).toBe(
      "\x1b[1;5B",
    );
  });

  it("modifier Ctrl+ArrowRight returns \\x1b[1;5C", () => {
    expect(encodeKey(keyWithMods("ArrowRight", { ctrlKey: true }))).toBe(
      "\x1b[1;5C",
    );
  });

  it("modifier Ctrl+ArrowLeft returns \\x1b[1;5D", () => {
    expect(encodeKey(keyWithMods("ArrowLeft", { ctrlKey: true }))).toBe(
      "\x1b[1;5D",
    );
  });

  it("modifier Shift+ArrowUp returns \\x1b[1;2A", () => {
    expect(encodeKey(keyWithMods("ArrowUp", { shiftKey: true }))).toBe(
      "\x1b[1;2A",
    );
  });

  // ── Unhandled keys return null ────────────────────────────────────────────

  it("encode unhandled key 'Control' returns null", () => {
    expect(encodeKey(key("Control"))).toBeNull();
  });

  it("encode unhandled key 'Shift' returns null", () => {
    expect(encodeKey(key("Shift"))).toBeNull();
  });
});
