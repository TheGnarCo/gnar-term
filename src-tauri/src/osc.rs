/// Classification of a parsed OSC sequence.
#[derive(Debug, PartialEq)]
pub(crate) enum OscAction {
    /// A user-facing notification (OSC 9 / 99 / 777).
    Notification(String),
    /// A window/tab title update (OSC 0 / 2).
    Title(String),
    /// An OSC we don't handle — ignore it.
    Ignore,
}

/// Sanitize a notification string received from PTY output.
///
/// Strips C0/C1 control characters (U+0000–U+001F, U+007F, U+0080–U+009F)
/// and caps the result at 500 characters so malicious PTY output can't
/// inject control sequences into native system notifications.
pub(crate) fn sanitize_notification(text: &str) -> String {
    text.chars()
        .filter(|&c| {
            let n = c as u32;
            // Exclude C0 (0x00–0x1F), DEL (0x7F), and C1 (0x80–0x9F)
            !(n <= 0x1F || n == 0x7F || (0x80..=0x9F).contains(&n))
        })
        .take(500)
        .collect()
}

/// Classify a raw OSC payload (the bytes between `ESC]` and `BEL`/`ST`).
///
/// Returns an `OscAction` describing what the sequence means.
pub(crate) fn classify_osc(raw: &str) -> OscAction {
    // OSC 0 or OSC 2: set window title  (e.g. "0;my title")
    if raw.starts_with("0;") || raw.starts_with("2;") {
        let title = raw.splitn(2, ';').nth(1).unwrap_or("").to_string();
        return OscAction::Title(title);
    }

    // OSC 9 (iTerm2), OSC 99 (kitty), OSC 777 (rxvt) notifications.
    let text = if let Some(rest) = raw.strip_prefix("9;") {
        rest
    } else if let Some(rest) = raw.strip_prefix("99;") {
        rest
    } else if let Some(rest) = raw.strip_prefix("777;") {
        rest
    } else {
        return OscAction::Ignore;
    };

    // Guard: if the payload starts with "<digits>;" it is a sub-command or
    // color-query response (e.g. "4;0;rgb:..."), not a human-readable
    // notification.  Drop it.
    if text.starts_with(|c: char| c.is_ascii_digit()) {
        if let Some(pos) = text.find(';') {
            if text[..pos].chars().all(|c| c.is_ascii_digit()) {
                return OscAction::Ignore;
            }
        }
    }

    // Empty payloads aren't useful either.
    if text.is_empty() {
        return OscAction::Ignore;
    }

    // Filter out color-query responses like "rgb:ffff/ffff/ffff" or "rgba:..."
    if text.starts_with("rgb:") || text.starts_with("rgba:") {
        return OscAction::Ignore;
    }

    // OSC 777's xterm/urxvt-style notification payload is
    // `notify;<title>;<body>` — Claude Code emits this. Parsing it here keeps
    // the raw "notify;Claude Code;…" string out of the UI so the workspace row
    // shows "Claude Code: <body>" instead of the literal prefix.
    if let Some(rest) = text.strip_prefix("notify;") {
        let (title, body) = rest.split_once(';').unwrap_or((rest, ""));
        let title = title.trim();
        let body = body.trim();
        let formatted = match (title.is_empty(), body.is_empty()) {
            (true, true) => return OscAction::Ignore,
            (false, true) => title.to_string(),
            (true, false) => body.to_string(),
            (false, false) => format!("{title}: {body}"),
        };
        return OscAction::Notification(sanitize_notification(&formatted));
    }

    OscAction::Notification(sanitize_notification(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Bug fix: OSC 7 CWD parsing (B2)
    // -----------------------------------------------------------------------

    #[test]
    fn osc7_parse_empty_hostname() {
        // file:///Users/foo → /Users/foo
        let url = "file:///Users/foo";
        let path = url.strip_prefix("file://").unwrap();
        let cwd = if path.starts_with('/') {
            path.to_string()
        } else if let Some(slash_idx) = path.find('/') {
            path[slash_idx..].to_string()
        } else {
            path.to_string()
        };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn osc7_parse_with_hostname() {
        // file://myhost/Users/foo → /Users/foo
        let url = "file://myhost/Users/foo";
        let path = url.strip_prefix("file://").unwrap();
        let cwd = if path.starts_with('/') {
            path.to_string()
        } else if let Some(slash_idx) = path.find('/') {
            path[slash_idx..].to_string()
        } else {
            path.to_string()
        };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn osc7_parse_no_scheme() {
        let url = "/Users/foo".to_string();
        let cwd = if let Some(path) = url.strip_prefix("file://") {
            if path.starts_with('/') {
                path.to_string()
            } else if let Some(slash_idx) = path.find('/') {
                path[slash_idx..].to_string()
            } else {
                path.to_string()
            }
        } else {
            url.clone()
        };
        assert_eq!(cwd, "/Users/foo");
    }

    // --- OSC classifier tests (issue #20) ---

    #[test]
    fn osc9_plain_text_is_notification() {
        assert_eq!(
            classify_osc("9;Build complete"),
            OscAction::Notification("Build complete".into())
        );
    }

    #[test]
    fn osc9_subcommand_is_ignored() {
        // "4;0;" is a color-query / sub-command, not a notification
        assert_eq!(classify_osc("9;4;0;"), OscAction::Ignore);
        assert_eq!(classify_osc("9;4;0;rgb:0000/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn osc99_plain_text_is_notification() {
        assert_eq!(
            classify_osc("99;Hello from kitty"),
            OscAction::Notification("Hello from kitty".into())
        );
    }

    #[test]
    fn osc777_notify_payload_is_humanized() {
        // OSC 777 `notify;<title>;<body>` is reformatted as "<title>: <body>"
        // so the raw "notify;" prefix never reaches the UI.
        assert_eq!(
            classify_osc("777;notify;Title;Body text"),
            OscAction::Notification("Title: Body text".into())
        );
    }

    #[test]
    fn osc777_notify_title_only() {
        assert_eq!(
            classify_osc("777;notify;Claude Code;"),
            OscAction::Notification("Claude Code".into())
        );
    }

    #[test]
    fn osc777_notify_body_only() {
        assert_eq!(
            classify_osc("777;notify;;Build succeeded"),
            OscAction::Notification("Build succeeded".into())
        );
    }

    #[test]
    fn osc777_notify_empty_is_ignored() {
        assert_eq!(classify_osc("777;notify;;"), OscAction::Ignore);
    }

    #[test]
    fn osc777_non_notify_payload_passes_through() {
        // A non-notify OSC 777 payload keeps its raw text (still sanitized).
        assert_eq!(
            classify_osc("777;other;Hello"),
            OscAction::Notification("other;Hello".into())
        );
    }

    #[test]
    fn sanitize_strips_c0_control_characters() {
        let input = "hello\x00world\x07\x1b[31m";
        assert_eq!(sanitize_notification(input), "helloworld[31m");
    }

    #[test]
    fn sanitize_strips_del_and_c1_controls() {
        let input = "foo\x7fbar\u{0080}\u{009f}baz";
        assert_eq!(sanitize_notification(input), "foobarbaz");
    }

    #[test]
    fn sanitize_truncates_to_500_chars() {
        let long = "a".repeat(600);
        assert_eq!(sanitize_notification(&long).chars().count(), 500);
    }

    #[test]
    fn sanitize_preserves_normal_unicode() {
        let input = "Build complete \u{2705}";
        assert_eq!(sanitize_notification(input), input);
    }

    #[test]
    fn osc_notification_is_sanitized() {
        // The ESC control byte is stripped; the remaining printable bytes
        // ("[0m") are preserved — sanitize only removes control characters.
        assert_eq!(
            classify_osc("9;done\x1b[0mok"),
            OscAction::Notification("done[0mok".into())
        );
    }

    #[test]
    fn osc0_sets_title() {
        assert_eq!(
            classify_osc("0;my terminal title"),
            OscAction::Title("my terminal title".into())
        );
    }

    #[test]
    fn osc2_sets_title() {
        assert_eq!(
            classify_osc("2;window name"),
            OscAction::Title("window name".into())
        );
    }

    #[test]
    fn osc_unknown_is_ignored() {
        assert_eq!(classify_osc("52;c;dGVzdA=="), OscAction::Ignore);
        assert_eq!(classify_osc("4;1;rgb:ffff/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn osc9_empty_payload_is_ignored() {
        assert_eq!(classify_osc("9;"), OscAction::Ignore);
    }

    #[test]
    fn osc9_text_starting_with_letter_is_notification() {
        assert_eq!(
            classify_osc("9;3 new emails"),
            OscAction::Notification("3 new emails".into())
        );
    }

    #[test]
    fn osc9_number_without_semicolon_is_notification() {
        // A payload like "9;42" — just a number, no sub-command semicolon
        assert_eq!(
            classify_osc("9;42"),
            OscAction::Notification("42".into())
        );
    }
}
