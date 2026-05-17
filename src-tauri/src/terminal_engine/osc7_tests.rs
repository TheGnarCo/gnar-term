//! Tests for the OSC 7 cwd parser — cycle-18, AC-3.
//!
//! Test-name convention: names contain "osc7" or "parse_osc7" so the
//! verify-envelope gate finds them.

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::terminal_engine::osc7::{parse_osc7, Osc7Emitter};

    // ─── parse_osc7 unit tests ────────────────────────────────────────────────

    /// parse_osc7 strips `file://hostname/path` and returns the path.
    #[test]
    fn osc7_parses_file_url_to_path() {
        let result = parse_osc7(b"file://localhost/home/user/projects");
        assert_eq!(result, Some(PathBuf::from("/home/user/projects")));
    }

    /// parse_osc7 handles an empty hostname (just `file:///path`).
    #[test]
    fn osc7_parses_file_url_empty_host() {
        let result = parse_osc7(b"file:///tmp/mydir");
        assert_eq!(result, Some(PathBuf::from("/tmp/mydir")));
    }

    /// parse_osc7 returns None for non-file:// payloads.
    #[test]
    fn osc7_rejects_non_file_url() {
        let result = parse_osc7(b"https://example.com/path");
        assert_eq!(result, None);
    }

    /// parse_osc7 returns None for empty input.
    #[test]
    fn osc7_rejects_empty_payload() {
        let result = parse_osc7(b"");
        assert_eq!(result, None);
    }

    /// parse_osc7 URL-decodes percent-encoded characters in the path.
    #[test]
    fn osc7_url_decodes_path() {
        // "My%20Documents" should decode to "My Documents"
        let result = parse_osc7(b"file://localhost/home/user/My%20Documents");
        assert_eq!(result, Some(PathBuf::from("/home/user/My Documents")));
    }

    /// parse_osc7 handles macOS-style `file://hostname/path` where hostname
    /// is the machine name (non-empty, non-localhost).
    #[test]
    fn osc7_parses_macos_style_hostname() {
        let result = parse_osc7(b"file://mymachine.local/Users/alice/dev");
        assert_eq!(result, Some(PathBuf::from("/Users/alice/dev")));
    }

    /// parse_osc7 handles a bare path with no host segment after `file://`.
    /// Some shells (e.g., fish) emit `file:///path` with a triple slash.
    #[test]
    fn osc7_parses_triple_slash_url() {
        let result = parse_osc7(b"file:///var/folders/abc");
        assert_eq!(result, Some(PathBuf::from("/var/folders/abc")));
    }

    // ─── Osc7Emitter tests ────────────────────────────────────────────────────

    /// Feeding an OSC 7 escape sequence to the emitter calls the callback with
    /// the parsed path.
    ///
    /// This test verifies the `cwd_changed_event_emits_on_osc7_feed` scenario:
    /// Osc7Emitter drives parse_osc7 and invokes a user-supplied callback so
    /// PtyBridge can route cwd-changed events to the frontend.
    #[test]
    fn cwd_changed_event_emits_on_osc7_feed() {
        let mut received: Vec<PathBuf> = Vec::new();

        let mut emitter = Osc7Emitter::new(|path| {
            received.push(path);
        });

        // Feed the raw OSC 7 payload (not the full escape sequence — the
        // alacritty_terminal layer already strips the OSC wrapper).
        emitter.handle(b"file://localhost/home/alice/work");

        assert_eq!(received.len(), 1, "expected one cwd emission");
        assert_eq!(received[0], PathBuf::from("/home/alice/work"));
    }

    /// Feeding an invalid payload results in no callback invocation.
    #[test]
    fn osc7_emitter_does_not_emit_on_invalid_payload() {
        let mut called = false;
        let mut emitter = Osc7Emitter::new(|_path| {
            called = true;
        });

        emitter.handle(b"not-a-file-url");

        assert!(!called, "callback should not fire on invalid payload");
    }
}
