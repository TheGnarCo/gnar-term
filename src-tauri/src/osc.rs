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

    OscAction::Notification(text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_osc0() {
        assert_eq!(classify_osc("0;my title"), OscAction::Title("my title".into()));
    }

    #[test]
    fn title_osc2() {
        assert_eq!(classify_osc("2;vim"), OscAction::Title("vim".into()));
    }

    #[test]
    fn notification_osc9() {
        assert_eq!(classify_osc("9;Build done"), OscAction::Notification("Build done".into()));
    }

    #[test]
    fn ignore_color_query() {
        assert_eq!(classify_osc("4;0;rgb:ffff/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn ignore_unknown() {
        assert_eq!(classify_osc("52;c;base64data"), OscAction::Ignore);
    }
}
