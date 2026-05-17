/**
 * key-corpus.ts — Cmd/Ctrl modifier key corpus for the alacritty key encoder.
 *
 * This module defines:
 *
 * 1. `INTERCEPTED_SHORTCUTS` — a set of modifier combos that should NOT be
 *    forwarded to the PTY because they are handled by the application shell
 *    (App.svelte / command palette / workspace shortcuts). Mirrors the
 *    `createKeyHandler` interception list from xterm's custom key handler in
 *    `terminal-service.ts`.
 *
 * 2. `lookupKey(event)` — returns the encoded bytes to send to the PTY for a
 *    given KeyboardEvent, or `null` when the key should be suppressed (either
 *    because it's an app-level shortcut or unrecognised).
 *
 * cycle-21 imports `lookupKey` (and `isIntercepted`) from here and wires them
 * into `AlacrittyTerminalSurface.svelte`. Do NOT import from
 * `alacritty-key-encoder.ts` inside this module — cycle-21 owns that wiring.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Compact key descriptor used as the lookup key in the corpus table. */
export interface KeyDescriptor {
  /** The KeyboardEvent.key value (case-insensitive comparison is applied). */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
}

// ─── App-level shortcut interception ─────────────────────────────────────────
//
// The lists below mirror the `createKeyHandler` function in terminal-service.ts.
// A key combination that appears here should return `false` from the key
// handler (i.e. the PTY never sees it); App.svelte handles it instead.
//
// macOS: intercept metaKey combos; Linux: intercept ctrlKey+shiftKey combos.

/**
 * macOS Cmd shortcuts intercepted by the app shell (no Shift, no Alt unless
 * noted).
 */
const MAC_CMD_KEYS_NO_MODIFIER = new Set([
  "c",
  "v",
  "n",
  "t",
  "d",
  "w",
  "b",
  "p",
  "k",
  "f",
  "g",
  "r",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "=",
  "+",
  "-",
]);

/**
 * macOS Cmd+Shift shortcuts intercepted by the app shell.
 */
const MAC_CMD_SHIFT_KEYS = new Set([
  "d",
  "w",
  "h",
  "r",
  "p",
  "g",
  "t",
  "enter",
  "[",
  "]",
]);

/**
 * macOS Cmd+Alt arrow keys intercepted by the app shell.
 */
const MAC_CMD_ALT_ARROWS = new Set([
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
]);

/**
 * Linux Ctrl+Shift shortcuts intercepted by the app shell (no Alt).
 */
const LINUX_CTRL_SHIFT_KEYS = new Set([
  "n",
  "t",
  "d",
  "e",
  "w",
  "q",
  "b",
  "p",
  "k",
  "f",
  "g",
  "h",
  "r",
  "~",
  "0",
  "enter",
  "[",
  "]",
  "=",
  "+",
  "-",
  "_",
]);

// ─── Interception predicate ───────────────────────────────────────────────────

/**
 * Returns `true` when the given event should be intercepted by the app shell
 * rather than forwarded to the PTY.
 *
 * Call this from the keydown handler before calling `lookupKey`. If it returns
 * `true`, suppress the event and let App.svelte handle it.
 *
 * Mirrors `createKeyHandler` in `terminal-service.ts`:
 * - macOS: Ctrl+Tab, Ctrl+Shift+C/V (copy/paste), Cmd combos listed above.
 * - Linux: Ctrl+Shift combos listed above.
 */
export function isIntercepted(event: KeyboardEvent, isMac: boolean): boolean {
  if (event.type !== "keydown") return false;

  // Ctrl+Tab — intercepted on all platforms (pane switch)
  if (event.ctrlKey && !event.metaKey && event.key === "Tab") return true;

  // Ctrl+Shift+C / Ctrl+Shift+V — copy/paste on all platforms
  if (event.ctrlKey && event.shiftKey && !event.metaKey) {
    const k = event.key.toLowerCase();
    if (k === "c" || k === "v") return true;
  }

  if (isMac) {
    // On macOS: Ctrl+V forwards \x16 (literal ^V) to PTY — NOT intercepted
    // here (the encoder handles it). Everything without metaKey passes through.
    if (!event.metaKey) return false;

    const k = event.key.toLowerCase();
    const shift = event.shiftKey;
    const alt = event.altKey;

    if (!alt && !shift && MAC_CMD_KEYS_NO_MODIFIER.has(k)) return true;
    if (shift && !alt && MAC_CMD_SHIFT_KEYS.has(k)) return true;
    if (alt && MAC_CMD_ALT_ARROWS.has(k)) return true;
  } else {
    // Linux: only Ctrl+Shift combos without Alt are intercepted
    if (!event.ctrlKey || !event.shiftKey) return false;
    const k = event.key.toLowerCase();
    if (!event.altKey && LINUX_CTRL_SHIFT_KEYS.has(k)) return true;
  }

  return false;
}

// ─── Ctrl+letter → control-character encoding ────────────────────────────────

/**
 * Encode Ctrl+letter combos (Ctrl+A..Z → 0x01..0x1A and a handful of
 * Ctrl+punctuation sequences). Returns a `Uint8Array` on match, else `null`.
 *
 * This table is the canonical corpus used by the key encoder. cycle-21 wires
 * this into `AlacrittyTerminalSurface.svelte`.
 */
export function encodeCtrlKey(key: string): Uint8Array | null {
  const c = key.toLowerCase();
  if (c.length === 1) {
    if (c >= "a" && c <= "z") {
      // Ctrl+A → 0x01, … Ctrl+Z → 0x1A
      return new Uint8Array([c.charCodeAt(0) - 96]);
    }
    switch (c) {
      case "@":
        return new Uint8Array([0x00]); // NUL
      case "[":
        return new Uint8Array([0x1b]); // ESC
      case "\\":
        return new Uint8Array([0x1c]); // FS
      case "]":
        return new Uint8Array([0x1d]); // GS
      case "^":
        return new Uint8Array([0x1e]); // RS
      case "_":
        return new Uint8Array([0x1f]); // US
      case " ":
        return new Uint8Array([0x00]); // Ctrl+Space → NUL
    }
  }
  return null;
}

// ─── Modifier-encoded key lookup ──────────────────────────────────────────────

/**
 * Returns the PTY byte sequence for the given `KeyboardEvent`, or `null` when:
 *  - The event is an intercepted app-level shortcut (call `isIntercepted` first).
 *  - The key is not recognised.
 *
 * This function handles the modifier-encoding layer (Ctrl+letter, Alt-prefix,
 * modifier-encoded CSI sequences). For basic printable keys and unmodified
 * named keys cycle-21 delegates to `encodeKey` from `alacritty-key-encoder.ts`.
 *
 * Returns `null` (not an empty array) for all keys that should be suppressed.
 */
export function lookupKey(event: KeyboardEvent): Uint8Array | null {
  const { key, ctrlKey, altKey, shiftKey, metaKey } = event;

  // ── Ctrl+letter combos ────────────────────────────────────────────────────
  if (ctrlKey && !altKey && !metaKey) {
    const encoded = encodeCtrlKey(key);
    if (encoded !== null) return encoded;
  }

  // ── Alt-prefix for single printable keys ──────────────────────────────────
  // Must come before the named-key block so Alt+F1 doesn't accidentally match.
  if (altKey && !ctrlKey && !metaKey && key.length === 1) {
    return new Uint8Array([0x1b, ...new TextEncoder().encode(key)]);
  }

  // Modifier code: xterm encoding: shift=1, alt=2, ctrl=4 (add 1 for wire value)
  const modBits = (shiftKey ? 1 : 0) + (altKey ? 2 : 0) + (ctrlKey ? 4 : 0);
  const mod = modBits === 0 ? 0 : modBits + 1;

  // ── Arrow keys with optional modifier ─────────────────────────────────────
  const arrowSuffix: Record<string, number> = {
    ArrowUp: 0x41, // A
    ArrowDown: 0x42, // B
    ArrowRight: 0x43, // C
    ArrowLeft: 0x44, // D
  };
  if (key in arrowSuffix) {
    const suffix = arrowSuffix[key]!;
    if (mod !== 0) {
      return encodeString(`\x1b[1;${mod}${String.fromCharCode(suffix)}`);
    }
    return new Uint8Array([0x1b, 0x5b, suffix]); // ESC [ {A|B|C|D}
  }

  // ── Named special keys ─────────────────────────────────────────────────────
  switch (key) {
    case "Enter":
      return new Uint8Array([0x0d]); // CR
    case "Backspace":
      return new Uint8Array([0x7f]); // DEL
    case "Tab":
      return new Uint8Array([0x09]); // HT
    case "Escape":
      return new Uint8Array([0x1b]); // ESC

    // F1-F4: SS3 application mode, or modifier-CSI
    case "F1":
      return mod !== 0
        ? encodeString(`\x1b[1;${mod}P`)
        : encodeString("\x1bOP");
    case "F2":
      return mod !== 0
        ? encodeString(`\x1b[1;${mod}Q`)
        : encodeString("\x1bOQ");
    case "F3":
      return mod !== 0
        ? encodeString(`\x1b[1;${mod}R`)
        : encodeString("\x1bOR");
    case "F4":
      return mod !== 0
        ? encodeString(`\x1b[1;${mod}S`)
        : encodeString("\x1bOS");

    // F5-F12: CSI ~ sequences
    case "F5":
      return csiTilde(15, mod);
    case "F6":
      return csiTilde(17, mod);
    case "F7":
      return csiTilde(18, mod);
    case "F8":
      return csiTilde(19, mod);
    case "F9":
      return csiTilde(20, mod);
    case "F10":
      return csiTilde(21, mod);
    case "F11":
      return csiTilde(23, mod);
    case "F12":
      return csiTilde(24, mod);

    // Home / End
    case "Home":
      return mod !== 0
        ? encodeString(`\x1b[1;${mod}H`)
        : encodeString("\x1bOH");
    case "End":
      return mod !== 0
        ? encodeString(`\x1b[1;${mod}F`)
        : encodeString("\x1bOF");

    // PageUp / PageDown
    case "PageUp":
      return csiTilde(5, mod);
    case "PageDown":
      return csiTilde(6, mod);

    // Insert / Delete
    case "Insert":
      return csiTilde(2, mod);
    case "Delete":
      return csiTilde(3, mod);
  }

  // ── Printable fallthrough ──────────────────────────────────────────────────
  if (!ctrlKey && !altKey && !metaKey && key.length === 1) {
    return new TextEncoder().encode(key);
  }

  return null;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function encodeString(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function csiTilde(n: number, mod: number): Uint8Array {
  if (mod !== 0) {
    return encodeString(`\x1b[${n};${mod}~`);
  }
  return encodeString(`\x1b[${n}~`);
}
