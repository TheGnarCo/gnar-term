//! OSC 7 cwd parser — cycle-18, AC-3.
//!
//! OSC 7 (`\x1b]7;file://hostname/path\x07`) is the "set current working
//! directory" escape sequence emitted by shells such as bash (with
//! `PROMPT_COMMAND`), zsh (`precmd`), and fish (built-in). The alacritty
//! terminal layer strips the OSC wrapper and passes only the payload string
//! to the event handler.
//!
//! # API
//!
//! - [`parse_osc7`] — stateless parser: `&[u8] → Option<PathBuf>`.
//! - [`Osc7Emitter`] — wraps `parse_osc7` with a callback so `PtyBridge` can
//!   route cwd-changed events to the frontend without coupling the parser to
//!   any specific event type.
//!
//! # Integration point for cycle-21 / `PtyBridge`
//!
//! `PtyBridge::feed_and_emit` drains `AlacrittyEngine::drain_events()` after
//! each `feed`. The `alacritty_terminal` crate does *not* expose OSC 7 as a
//! named `Event` variant — the OSC 7 escape is silently consumed by the VTE
//! processor and the cwd is never surfaced.
//!
//! **Wrapping approach chosen over forking**: to avoid vendoring/forking
//! `alacritty_terminal`, `PtyBridge` should instantiate a second VTE processor
//! that runs *in parallel* over the same byte stream and delegates unknown
//! escapes — specifically OSC 7 — to `Osc7Emitter`. cycle-21 wires this up.
//! The surface exported for cycle-21 is:
//!
//! ```rust,ignore
//! // In PtyBridge (cycle-21 wires this):
//! let mut osc_tap = Osc7Emitter::new(move |path| {
//!     // emit Tauri "cwd-changed" event with path.display().to_string()
//! });
//! // In the feed loop:
//! osc_tap.scan(bytes); // scan raw PTY bytes for OSC 7 sequences
//! ```

use std::path::PathBuf;

// ─── parse_osc7 ──────────────────────────────────────────────────────────────

/// Parse an OSC 7 payload and extract the filesystem path.
///
/// The expected format is `file://[hostname]/path` where:
/// - `hostname` is optional (empty string or any hostname — we strip it).
/// - `path` is an absolute POSIX path, optionally percent-encoded.
///
/// Returns `None` if:
/// - The payload does not start with `file://`.
/// - The payload is empty or otherwise malformed.
///
/// Percent-decoding is applied to the path portion only (`%HH` sequences
/// where `HH` is a hex pair). Unknown `%XX` sequences are passed through
/// unchanged to match browser/shell behaviour.
pub fn parse_osc7(payload: &[u8]) -> Option<PathBuf> {
    let s = std::str::from_utf8(payload).ok()?;

    // Must start with "file://"
    let after_scheme = s.strip_prefix("file://")?;

    // Find the first '/' which separates hostname from path.
    // For `file://localhost/path`, after_scheme = "localhost/path".
    // For `file:///path`, after_scheme = "/path".
    let path_str = if let Some(slash_pos) = after_scheme.find('/') {
        &after_scheme[slash_pos..] // includes the leading '/'
    } else {
        return None; // no path component at all
    };

    // Percent-decode the path.
    let decoded = percent_decode(path_str);

    if decoded.is_empty() || !decoded.starts_with('/') {
        return None;
    }

    Some(PathBuf::from(decoded))
}

/// Decode `%XX` percent-encoded characters in `s`.
///
/// Only ASCII hexadecimal pairs following `%` are decoded; any `%` not
/// followed by exactly two hex digits is left as-is.
fn percent_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = bytes[i + 1];
            let lo = bytes[i + 2];
            if let (Some(h), Some(l)) = (hex_val(hi), hex_val(lo)) {
                let decoded_byte = (h << 4) | l;
                // Treat decoded bytes as UTF-8; single ASCII byte here.
                result.push(decoded_byte as char);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Convert an ASCII hex digit byte to its numeric value (0–15), or `None`.
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// ─── Osc7Emitter ─────────────────────────────────────────────────────────────

/// Callback-based OSC 7 handler.
///
/// `PtyBridge` can hold one of these and call [`Osc7Emitter::handle`] with raw
/// OSC 7 payloads (the bytes after the `alacritty_terminal` VTE layer strips the
/// OSC wrapper). When a valid `file://` URL is found, the callback is invoked
/// with the decoded `PathBuf`.
///
/// For scanning raw PTY bytes (where the OSC wrapper is still present), use
/// [`Osc7Emitter::scan`] which does a lightweight search for OSC 7 sequences
/// without a full VTE parser.
///
/// # Design note
///
/// `alacritty_terminal` does not surface OSC 7 as an `Event` variant. Rather
/// than forking the crate, `Osc7Emitter::scan` does a byte-level scan of the
/// raw PTY stream in parallel with the engine's `Processor::advance` call.
/// This avoids any dependency on `alacritty_terminal` internals.
pub struct Osc7Emitter<F>
where
    F: FnMut(PathBuf),
{
    callback: F,
}

impl<F> Osc7Emitter<F>
where
    F: FnMut(PathBuf),
{
    /// Create a new emitter. `callback` is called once per valid OSC 7 payload.
    pub fn new(callback: F) -> Self {
        Self { callback }
    }

    /// Handle a pre-extracted OSC 7 payload (the bytes already stripped of the
    /// `\x1b]7;` prefix and `\x07` / `\x1b\\` terminator).
    ///
    /// Calls `callback` if the payload successfully parses to a `PathBuf`.
    pub fn handle(&mut self, payload: &[u8]) {
        if let Some(path) = parse_osc7(payload) {
            (self.callback)(path);
        }
    }

    /// Scan raw PTY bytes for OSC 7 sequences and invoke the callback for each
    /// one found.
    ///
    /// This does a lightweight byte-level scan rather than a full VTE parse.
    /// The sequence format scanned is:
    ///
    /// ```text
    /// ESC ] 7 ; <payload> BEL
    /// ESC ] 7 ; <payload> ESC \   (ST — String Terminator)
    /// ```
    ///
    /// Where `ESC = \x1b`, `BEL = \x07`.
    ///
    /// This scan runs in O(n) time and does not allocate unless an OSC 7
    /// sequence is found.
    pub fn scan(&mut self, bytes: &[u8]) {
        let mut i = 0;
        while i < bytes.len() {
            // Look for ESC ] 7 ;
            if bytes[i] == 0x1b
                && i + 3 < bytes.len()
                && bytes[i + 1] == b']'
                && bytes[i + 2] == b'7'
                && bytes[i + 3] == b';'
            {
                let payload_start = i + 4;
                // Find the terminator: BEL (0x07) or ESC \ (0x1b 0x5c)
                let mut j = payload_start;
                while j < bytes.len() {
                    if bytes[j] == 0x07 {
                        // BEL terminator
                        self.handle(&bytes[payload_start..j]);
                        i = j + 1;
                        break;
                    } else if bytes[j] == 0x1b && j + 1 < bytes.len() && bytes[j + 1] == b'\\' {
                        // ST (String Terminator) = ESC \
                        self.handle(&bytes[payload_start..j]);
                        i = j + 2;
                        break;
                    }
                    j += 1;
                }
                if j >= bytes.len() {
                    // Unterminated sequence — skip to end.
                    break;
                }
            } else {
                i += 1;
            }
        }
    }
}

// ─── Include tests ────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "osc7_tests.rs"]
mod osc7_tests;
