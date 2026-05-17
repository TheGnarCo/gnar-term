/**
 * paste-handler.test.ts
 *
 * Unit tests for bracketed paste mode handling.
 *
 * AC keyword: bracketed_paste (AC-4)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PasteHandler,
  BRACKETED_PASTE_START,
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_ENABLE,
  BRACKETED_PASTE_DISABLE,
  stripBracketedPasteTerminators,
  detectBracketedPasteModeChange,
} from "./paste-handler";

const enc = new TextEncoder();

describe("bracketed_paste mode tracking", () => {
  let handler: PasteHandler;

  beforeEach(() => {
    handler = new PasteHandler();
  });

  it("bracketed_paste_disabled_by_default", () => {
    expect(handler.isBracketedPasteEnabled).toBe(false);
  });

  it("bracketed_paste_enabled_after_setBracketedPaste_true", () => {
    handler.setBracketedPaste(true);
    expect(handler.isBracketedPasteEnabled).toBe(true);
  });

  it("bracketed_paste_disabled_after_setBracketedPaste_false", () => {
    handler.setBracketedPaste(true);
    handler.setBracketedPaste(false);
    expect(handler.isBracketedPasteEnabled).toBe(false);
  });
});

describe("bracketed_paste_round_trip_wraps_with_200_and_201", () => {
  let handler: PasteHandler;

  beforeEach(() => {
    handler = new PasteHandler();
  });

  it("bracketed_paste_round_trip_wraps_with_200_and_201 when enabled", () => {
    handler.setBracketedPaste(true);
    const result = handler.encodePaste("hello");
    const expected = enc.encode(
      BRACKETED_PASTE_START + "hello" + BRACKETED_PASTE_END,
    );
    expect(result).toEqual(expected);
  });

  it("bracketed_paste_encodes_raw_when_disabled", () => {
    handler.setBracketedPaste(false);
    const result = handler.encodePaste("hello");
    expect(result).toEqual(enc.encode("hello"));
  });

  it("bracketed_paste_handles_empty_string", () => {
    handler.setBracketedPaste(true);
    const result = handler.encodePaste("");
    const expected = enc.encode(BRACKETED_PASTE_START + BRACKETED_PASTE_END);
    expect(result).toEqual(expected);
  });

  it("bracketed_paste_handles_multiline_text", () => {
    handler.setBracketedPaste(true);
    const text = "line1\nline2\n";
    const result = handler.encodePaste(text);
    const expected = enc.encode(
      BRACKETED_PASTE_START + text + BRACKETED_PASTE_END,
    );
    expect(result).toEqual(expected);
  });

  it("bracketed_paste_handles_unicode_text", () => {
    handler.setBracketedPaste(true);
    const text = "こんにちは";
    const result = handler.encodePaste(text);
    const expected = enc.encode(
      BRACKETED_PASTE_START + text + BRACKETED_PASTE_END,
    );
    expect(result).toEqual(expected);
  });
});

describe("bracketed_paste_security_strips_terminators", () => {
  let handler: PasteHandler;

  beforeEach(() => {
    handler = new PasteHandler();
  });

  it("bracketed_paste_strips_embedded_terminator_to_prevent_injection", () => {
    handler.setBracketedPaste(true);
    // The pasted text contains a rogue terminator — this must be stripped.
    const malicious = `safe text${BRACKETED_PASTE_END}rm -rf /`;
    const result = handler.encodePaste(malicious);
    const decoded = new TextDecoder().decode(result);
    // The result should not contain the bare terminator in the middle
    expect(decoded).toBe(
      BRACKETED_PASTE_START + "safe textrm -rf /" + BRACKETED_PASTE_END,
    );
  });

  it("bracketed_paste_strips_embedded_opener_to_prevent_double_wrapping", () => {
    handler.setBracketedPaste(true);
    const text = `before${BRACKETED_PASTE_START}after`;
    const result = handler.encodePaste(text);
    const decoded = new TextDecoder().decode(result);
    expect(decoded).toBe(
      BRACKETED_PASTE_START + "beforeafter" + BRACKETED_PASTE_END,
    );
  });
});

describe("stripBracketedPasteTerminators", () => {
  it("bracketed_paste_strip_removes_end_sequence", () => {
    expect(stripBracketedPasteTerminators("abc\x1b[201~def")).toBe("abcdef");
  });

  it("bracketed_paste_strip_removes_start_sequence", () => {
    expect(stripBracketedPasteTerminators("abc\x1b[200~def")).toBe("abcdef");
  });

  it("bracketed_paste_strip_removes_multiple_occurrences", () => {
    const input = `a\x1b[201~b\x1b[201~c`;
    expect(stripBracketedPasteTerminators(input)).toBe("abc");
  });

  it("bracketed_paste_strip_returns_plain_text_unchanged", () => {
    expect(stripBracketedPasteTerminators("hello world")).toBe("hello world");
  });
});

describe("detectBracketedPasteModeChange", () => {
  it("bracketed_paste_detects_enable_sequence", () => {
    expect(detectBracketedPasteModeChange(BRACKETED_PASTE_ENABLE)).toBe(true);
  });

  it("bracketed_paste_detects_disable_sequence", () => {
    expect(detectBracketedPasteModeChange(BRACKETED_PASTE_DISABLE)).toBe(false);
  });

  it("bracketed_paste_returns_null_for_unrelated_output", () => {
    expect(detectBracketedPasteModeChange("hello world")).toBeNull();
  });

  it("bracketed_paste_disable_wins_over_enable_in_same_chunk", () => {
    // When both appear in one chunk, the last one in the string wins
    const chunk =
      BRACKETED_PASTE_ENABLE + "some output" + BRACKETED_PASTE_DISABLE;
    expect(detectBracketedPasteModeChange(chunk)).toBe(false);
  });

  it("bracketed_paste_enable_after_disable_in_chunk_sets_true_then_false", () => {
    // enable then disable → false
    const chunk = BRACKETED_PASTE_ENABLE + BRACKETED_PASTE_DISABLE;
    expect(detectBracketedPasteModeChange(chunk)).toBe(false);
  });

  it("bracketed_paste_enable_constant_is_ESC_bracket_question_2004h", () => {
    expect(BRACKETED_PASTE_ENABLE).toBe("\x1b[?2004h");
  });

  it("bracketed_paste_disable_constant_is_ESC_bracket_question_2004l", () => {
    expect(BRACKETED_PASTE_DISABLE).toBe("\x1b[?2004l");
  });
});
