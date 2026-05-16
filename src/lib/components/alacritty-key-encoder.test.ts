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

  // ── Unhandled keys return null ────────────────────────────────────────────

  it("encode unhandled key 'F1' returns null", () => {
    expect(encodeKey(key("F1"))).toBeNull();
  });

  it("encode unhandled key 'Home' returns null", () => {
    expect(encodeKey(key("Home"))).toBeNull();
  });

  it("encode unhandled key 'Insert' returns null", () => {
    expect(encodeKey(key("Insert"))).toBeNull();
  });

  it("encode unhandled key 'Control' returns null", () => {
    expect(encodeKey(key("Control"))).toBeNull();
  });

  it("encode unhandled key 'Shift' returns null", () => {
    expect(encodeKey(key("Shift"))).toBeNull();
  });
});
