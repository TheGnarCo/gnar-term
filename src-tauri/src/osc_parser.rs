/// OSC (Operating System Command) sequence classifier.
///
/// Extracted from lib.rs for maintainability. Parses the payload bytes between
/// `ESC]` and `BEL`/`ST` and classifies them as notifications, title updates,
/// or ignorable sequences.
/// Classification of a parsed OSC sequence.
#[derive(Debug, PartialEq)]
pub enum OscAction {
    /// A user-facing notification (OSC 9 / 99 / 777).
    Notification(String),
    /// A window/tab title update (OSC 0 / 2).
    Title(String),
    /// An OSC we don't handle — ignore it.
    Ignore,
}

/// Classify a raw OSC payload (the bytes between `ESC]` and `BEL`/`ST`).
///
/// Returns an `OscAction` describing what the sequence means.
pub fn classify_osc(raw: &str) -> OscAction {
    // OSC 0 or OSC 2: set window title  (e.g. "0;my title")
    if raw.starts_with("0;") || raw.starts_with("2;") {
        let title = raw.split_once(';').map_or("", |(_, t)| t).to_string();
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

    OscAction::Notification(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn osc777_plain_text_is_notification() {
        assert_eq!(
            classify_osc("777;notify;Title;Body text"),
            OscAction::Notification("notify;Title;Body text".into())
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
        assert_eq!(classify_osc("9;42"), OscAction::Notification("42".into()));
    }

    // -----------------------------------------------------------------------
    // classify_osc edge cases
    // -----------------------------------------------------------------------

    #[test]
    fn osc_empty_string_is_ignored() {
        assert_eq!(classify_osc(""), OscAction::Ignore);
    }

    #[test]
    fn osc_single_char_is_ignored() {
        assert_eq!(classify_osc("x"), OscAction::Ignore);
    }

    #[test]
    fn osc_just_semicolon_is_ignored() {
        assert_eq!(classify_osc(";"), OscAction::Ignore);
    }

    #[test]
    fn osc0_empty_title() {
        // OSC 0 with empty title after semicolon
        assert_eq!(classify_osc("0;"), OscAction::Title(String::new()));
    }

    #[test]
    fn osc2_empty_title() {
        assert_eq!(classify_osc("2;"), OscAction::Title(String::new()));
    }

    #[test]
    fn osc0_title_with_special_chars() {
        assert_eq!(
            classify_osc("0;user@host: ~/src [git:main]"),
            OscAction::Title("user@host: ~/src [git:main]".into())
        );
    }

    #[test]
    fn osc0_title_with_semicolons() {
        // The title itself may contain semicolons — only the first splits the code
        assert_eq!(classify_osc("0;a;b;c"), OscAction::Title("a;b;c".into()));
    }

    #[test]
    fn osc2_title_with_unicode() {
        assert_eq!(
            classify_osc("2;\u{1F680} rocket terminal"),
            OscAction::Title("\u{1F680} rocket terminal".into())
        );
    }

    #[test]
    fn osc99_empty_payload_is_ignored() {
        assert_eq!(classify_osc("99;"), OscAction::Ignore);
    }

    #[test]
    fn osc777_empty_payload_is_ignored() {
        assert_eq!(classify_osc("777;"), OscAction::Ignore);
    }

    #[test]
    fn osc99_subcommand_is_ignored() {
        assert_eq!(classify_osc("99;4;0;rgb:0000/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn osc777_subcommand_is_ignored() {
        assert_eq!(classify_osc("777;4;0;"), OscAction::Ignore);
    }

    #[test]
    fn osc9_rgb_color_query_is_ignored() {
        assert_eq!(classify_osc("9;rgb:ffff/ffff/ffff"), OscAction::Ignore);
    }

    #[test]
    fn osc9_rgba_color_query_is_ignored() {
        assert_eq!(
            classify_osc("9;rgba:ffff/ffff/ffff/ffff"),
            OscAction::Ignore
        );
    }

    #[test]
    fn osc99_rgb_color_query_is_ignored() {
        assert_eq!(classify_osc("99;rgb:0000/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn osc9_notification_with_unicode() {
        assert_eq!(
            classify_osc("9;\u{2705} Tests passed"),
            OscAction::Notification("\u{2705} Tests passed".into())
        );
    }

    #[test]
    fn osc_very_long_payload_notification() {
        let long_text = "A".repeat(10_000);
        let raw = format!("9;{long_text}");
        assert_eq!(classify_osc(&raw), OscAction::Notification(long_text));
    }

    #[test]
    fn osc_very_long_payload_title() {
        let long_title = "T".repeat(10_000);
        let raw = format!("0;{long_title}");
        assert_eq!(classify_osc(&raw), OscAction::Title(long_title));
    }

    #[test]
    fn osc_prefix_without_semicolon_is_ignored() {
        // "0" alone (no semicolon) should not match "0;" prefix
        assert_eq!(classify_osc("0"), OscAction::Ignore);
        assert_eq!(classify_osc("2"), OscAction::Ignore);
        assert_eq!(classify_osc("9"), OscAction::Ignore);
        assert_eq!(classify_osc("99"), OscAction::Ignore);
        assert_eq!(classify_osc("777"), OscAction::Ignore);
    }

    #[test]
    fn osc_unrecognized_codes_are_ignored() {
        assert_eq!(classify_osc("1;something"), OscAction::Ignore);
        assert_eq!(classify_osc("3;something"), OscAction::Ignore);
        assert_eq!(classify_osc("7;file:///Users/foo"), OscAction::Ignore);
        assert_eq!(classify_osc("8;;https://example.com"), OscAction::Ignore);
        assert_eq!(classify_osc("10;?"), OscAction::Ignore);
        assert_eq!(classify_osc("133;A"), OscAction::Ignore);
    }

    #[test]
    fn osc9_text_starting_with_non_digit_is_notification() {
        assert_eq!(
            classify_osc("9;Build succeeded!"),
            OscAction::Notification("Build succeeded!".into())
        );
        assert_eq!(
            classify_osc("9; leading space"),
            OscAction::Notification(" leading space".into())
        );
    }

    #[test]
    fn osc9_digit_without_semicolon_is_notification() {
        // "42" has digits but no semicolon after them — not a sub-command
        assert_eq!(classify_osc("9;42"), OscAction::Notification("42".into()));
        assert_eq!(classify_osc("9;100"), OscAction::Notification("100".into()));
    }

    #[test]
    fn osc9_digit_semicolon_nonnumeric_is_not_subcommand() {
        // "3 new emails" starts with a digit followed by a space, not a semicolon
        assert_eq!(
            classify_osc("9;3 new emails"),
            OscAction::Notification("3 new emails".into())
        );
    }
}
