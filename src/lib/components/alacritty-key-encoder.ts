/**
 * alacritty-key-encoder.ts — keyboard event → PTY byte sequence encoder.
 *
 * Extracted from AlacrittyTerminalSurface.svelte so the encoding logic can
 * be unit-tested without a DOM environment.
 *
 * Phase 1 coverage:
 *   - Printable ASCII / single-grapheme-cluster keys (event.key.length === 1)
 *   - Enter → CR (\r)
 *   - Backspace → DEL (\x7f)
 *   - Tab → \t
 *   - Arrow keys → CSI A/B/C/D sequences
 *   - Escape → ESC (\x1b)
 *
 * TODO(cycle-7/phase-2): Add full xterm key encoding:
 *   - Ctrl+letter sequences (\x01–\x1a)
 *   - Alt/Meta combos (ESC prefix)
 *   - F1–F12 (SS3 / CSI ~ sequences)
 *   - Shift+arrow, Ctrl+arrow modifier combos
 *   - Home, End, Insert, Delete, Page Up/Down
 *   - Numpad keys
 */

/**
 * Encode a KeyboardEvent to a PTY byte sequence.
 *
 * Returns the byte sequence as a UTF-8 string suitable for passing to
 * `invoke("write_pty", { ptyId, data })`, or `null` for unhandled keys
 * (caller should not send anything to the PTY).
 */
export function encodeKey(event: KeyboardEvent): string | null {
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    default:
      // Printable ASCII / UTF-8 single grapheme cluster from keyboard
      if (event.key.length === 1) return event.key;
      return null;
  }
}
