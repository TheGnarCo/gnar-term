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
 * Phase 2 coverage (cycle-12):
 *   - F1–F4  → SS3 P/Q/R/S (DEC PF1-PF4 application-mode)
 *   - F5–F12 → CSI 15~/17~/18~/19~/20~/21~/23~/24~ sequences
 *   - Home → SS3 H, End → SS3 F
 *   - PageUp → CSI 5~, PageDown → CSI 6~
 *   - Insert → CSI 2~, Delete → CSI 3~
 *   - Ctrl+letter combos (\x01–\x1a) and Ctrl+special chars
 *   - Alt-prefix for printable keys (\x1b<char>)
 *   - Modifier-encoded arrows/F-keys/Home/End using CSI 1;Pm sequences
 */

// ─── Modifier bit mapping ─────────────────────────────────────────────────────
//
// xterm modifier encoding: Pm = shift + 2*alt + 4*ctrl + 8*meta + 1
// (shift=1, alt=2, ctrl=4, all add 1 to the total → result 1..8)
//
// Modifier codes used in CSI sequences:
//   Shift       → 2
//   Alt         → 3  (shift+alt → 4)
//   Ctrl        → 5  (shift+ctrl → 6, ctrl+alt → 7, ctrl+alt+shift → 8)

/**
 * Encode a KeyboardEvent to a PTY byte sequence.
 *
 * Returns the byte sequence as a UTF-8 string suitable for passing to
 * `invoke("write_pty", { ptyId, data })`, or `null` for unhandled keys
 * (caller should not send anything to the PTY).
 */
export function encodeKey(event: KeyboardEvent): string | null {
  const { key, ctrlKey, altKey, shiftKey } = event;

  // ─── Ctrl+letter combos ───────────────────────────────────────────────────
  // Must be checked before the printable-ASCII fallthrough so that e.g.
  // Ctrl+a doesn't just return "a".
  if (ctrlKey && !altKey) {
    const c = key.toLowerCase();
    if (c.length === 1) {
      // Ctrl+a–z → \x01–\x1a
      if (c >= "a" && c <= "z") {
        return String.fromCharCode(c.charCodeAt(0) - 96);
      }
      // Ctrl+@ → NUL (\x00)
      if (c === "@") return "\x00";
      // Ctrl+[ → ESC (\x1b)
      if (c === "[") return "\x1b";
      // Ctrl+\ → FS (\x1c)
      if (c === "\\") return "\x1c";
      // Ctrl+] → GS (\x1d)
      if (c === "]") return "\x1d";
      // Ctrl+^ → RS (\x1e)
      if (c === "^") return "\x1e";
      // Ctrl+_ → US (\x1f)
      if (c === "_") return "\x1f";
    }
  }

  // ─── Modifier code helper ─────────────────────────────────────────────────
  // Returns the xterm modifier number (2–8), or 0 if no modifier applies.
  const modCode = (): number => {
    // modifier base: shift=1, alt=2, ctrl=4 (add 1 for wire value)
    const bits = (shiftKey ? 1 : 0) + (altKey ? 2 : 0) + (ctrlKey ? 4 : 0);
    return bits === 0 ? 0 : bits + 1;
  };

  // ─── Arrow keys with optional modifier ────────────────────────────────────
  const arrowSuffix: Record<string, string> = {
    ArrowUp: "A",
    ArrowDown: "B",
    ArrowRight: "C",
    ArrowLeft: "D",
  };
  if (key in arrowSuffix) {
    const suffix = arrowSuffix[key]!;
    const mod = modCode();
    if (mod !== 0) {
      return `\x1b[1;${mod}${suffix}`;
    }
    return `\x1b[${suffix}`;
  }

  // ─── Named special keys ───────────────────────────────────────────────────
  switch (key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case "Escape":
      return "\x1b";

    // ── F1-F4: SS3 P/Q/R/S (DEC PF1-PF4 application-mode) ──────────────────
    case "F1": {
      const mod = modCode();
      return mod !== 0 ? `\x1b[1;${mod}P` : "\x1bOP";
    }
    case "F2": {
      const mod = modCode();
      return mod !== 0 ? `\x1b[1;${mod}Q` : "\x1bOQ";
    }
    case "F3": {
      const mod = modCode();
      return mod !== 0 ? `\x1b[1;${mod}R` : "\x1bOR";
    }
    case "F4": {
      const mod = modCode();
      return mod !== 0 ? `\x1b[1;${mod}S` : "\x1bOS";
    }

    // ── F5-F12: CSI ~ sequences ──────────────────────────────────────────────
    case "F5":
      return _csiTilde(15, modCode());
    case "F6":
      return _csiTilde(17, modCode());
    case "F7":
      return _csiTilde(18, modCode());
    case "F8":
      return _csiTilde(19, modCode());
    case "F9":
      return _csiTilde(20, modCode());
    case "F10":
      return _csiTilde(21, modCode());
    case "F11":
      return _csiTilde(23, modCode());
    case "F12":
      return _csiTilde(24, modCode());

    // ── Home / End ───────────────────────────────────────────────────────────
    case "Home": {
      const mod = modCode();
      return mod !== 0 ? `\x1b[1;${mod}H` : "\x1bOH";
    }
    case "End": {
      const mod = modCode();
      return mod !== 0 ? `\x1b[1;${mod}F` : "\x1bOF";
    }

    // ── PageUp / PageDown ────────────────────────────────────────────────────
    case "PageUp":
      return _csiTilde(5, modCode());
    case "PageDown":
      return _csiTilde(6, modCode());

    // ── Insert / Delete ──────────────────────────────────────────────────────
    case "Insert":
      return _csiTilde(2, modCode());
    case "Delete":
      return _csiTilde(3, modCode());
  }

  // ─── Alt-prefix for printable keys ────────────────────────────────────────
  // Must come after named-key handling so "Alt+F1" etc. don't accidentally fall here.
  if (altKey && !ctrlKey && key.length === 1) {
    return "\x1b" + key;
  }

  // ─── Printable ASCII / UTF-8 single grapheme cluster from keyboard ─────────
  if (key.length === 1) return key;
  return null;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build a CSI `Pn~` sequence, with optional modifier.
 *
 * Without modifier: `\x1b[{n}~`
 * With modifier:    `\x1b[{n};{mod}~`
 */
function _csiTilde(n: number, mod: number): string {
  if (mod !== 0) {
    return `\x1b[${n};${mod}~`;
  }
  return `\x1b[${n}~`;
}
