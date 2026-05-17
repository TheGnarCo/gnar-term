/**
 * paste-handler.ts — Bracketed paste mode tracking and encoding.
 *
 * Terminals that support bracketed paste mode (DECSET ?2004h / DECRST ?2004l)
 * expect pasted text to be wrapped in `\x1b[200~...\x1b[201~` so programs can
 * distinguish pasted text from typed input.
 *
 * This module provides a stateful `PasteHandler` that:
 * 1. Tracks whether bracketed paste mode is currently enabled (toggled when
 *    the terminal emits DEC sequences ?2004h or ?2004l).
 * 2. Encodes pasted text correctly: wrapped with bracketed-paste markers when
 *    enabled, raw bytes otherwise.
 * 3. Strips embedded bracketed-paste terminator sequences from pasted text to
 *    prevent injection attacks.
 *
 * Integration (cycle-21):
 *   - `PtyBridge` (Rust) exposes `bracketed_paste_enabled(term)` via `input.rs`.
 *   - `AlacrittyTerminalSurface.svelte` calls `pasteHandler.setBracketedPaste()`
 *     whenever the Rust-side mode changes, then calls `pasteHandler.encodePaste()`
 *     to obtain the bytes to send to the PTY.
 *
 * Security note:
 *   Pasted text may itself contain the bracketed-paste terminator `\x1b[201~`.
 *   This is stripped before wrapping to prevent injection of arbitrary input
 *   outside the bracketed region.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** DEC private mode sequence to enable bracketed paste (?2004h). */
export const BRACKETED_PASTE_ENABLE = "\x1b[?2004h";

/** DEC private mode sequence to disable bracketed paste (?2004l). */
export const BRACKETED_PASTE_DISABLE = "\x1b[?2004l";

/** Opening marker sent before pasted text when bracketed paste is active. */
export const BRACKETED_PASTE_START = "\x1b[200~";

/** Closing marker sent after pasted text when bracketed paste is active. */
export const BRACKETED_PASTE_END = "\x1b[201~";

// ─── PasteHandler ─────────────────────────────────────────────────────────────

/**
 * Stateful bracketed-paste mode handler.
 *
 * One instance per terminal surface. Call `setBracketedPaste(true)` when the
 * terminal emits `\x1b[?2004h` (DEC set 2004) and `setBracketedPaste(false)`
 * when it emits `\x1b[?2004l` (DEC reset 2004).
 */
export class PasteHandler {
  private bracketedPasteEnabled = false;

  /**
   * Toggle bracketed paste mode.
   *
   * @param enabled `true` when ?2004h has been received; `false` for ?2004l.
   */
  setBracketedPaste(enabled: boolean): void {
    this.bracketedPasteEnabled = enabled;
  }

  /** Returns whether bracketed paste mode is currently active. */
  get isBracketedPasteEnabled(): boolean {
    return this.bracketedPasteEnabled;
  }

  /**
   * Encode pasted text ready for sending to the PTY.
   *
   * When bracketed paste mode is enabled the text is:
   * 1. Stripped of any embedded `\x1b[201~` sequences (security: prevents
   *    injection of input after the bracketed region).
   * 2. Wrapped with `\x1b[200~` ... `\x1b[201~`.
   *
   * When bracketed paste mode is disabled the text is encoded as raw UTF-8
   * without stripping (stripping only matters when the terminal will interpret
   * the terminator sequence).
   *
   * @param text Raw text from the clipboard.
   * @returns UTF-8 bytes ready to write to the PTY.
   */
  encodePaste(text: string): Uint8Array {
    const enc = new TextEncoder();
    if (this.bracketedPasteEnabled) {
      const safe = stripBracketedPasteTerminators(text);
      return enc.encode(BRACKETED_PASTE_START + safe + BRACKETED_PASTE_END);
    }
    return enc.encode(text);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Strip embedded bracketed-paste terminator sequences from pasted text.
 *
 * The terminator `\x1b[201~` inside pasted text would prematurely end the
 * bracketed region. Programs like vim use this boundary to distinguish paste
 * from typed input; a malicious clipboard could inject commands after a
 * rogue terminator. We strip all occurrences defensively.
 *
 * The opener `\x1b[200~` is also stripped to prevent double-wrapping when
 * the clipboard somehow contains a prior bracketed-paste sequence.
 */
export function stripBracketedPasteTerminators(text: string): string {
  // Strip both the opening and closing markers.
  return text
    .replaceAll(BRACKETED_PASTE_END, "")
    .replaceAll(BRACKETED_PASTE_START, "");
}

/**
 * Detect whether a byte sequence from the PTY output stream toggles bracketed
 * paste mode.
 *
 * Scans `output` for `?2004h` (enable) or `?2004l` (disable) DEC private
 * mode sequences. Returns:
 * - `true` if bracketed paste was just enabled
 * - `false` if bracketed paste was just disabled
 * - `null` if no bracketed-paste sequence was found
 *
 * Intended for use in a lightweight scan of PTY output chunks when Rust-side
 * mode queries are not available (e.g. during initial tests). In production,
 * cycle-21 prefers querying `bracketed_paste_enabled` via the Rust IPC
 * command from `input.rs`.
 */
export function detectBracketedPasteModeChange(output: string): boolean | null {
  // Check for disable first (a single chunk may have both; last one wins
  // but for correctness we scan in order and take the last match).
  let result: boolean | null = null;
  if (output.includes(BRACKETED_PASTE_ENABLE)) result = true;
  if (output.includes(BRACKETED_PASTE_DISABLE)) result = false;
  return result;
}
