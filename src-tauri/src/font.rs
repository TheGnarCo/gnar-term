/// Font detection — reads terminal configs and system font lists to find the
/// user's preferred monospace font. Returns the CSS font-family name.
///
/// Strategy (first match wins):
///   1. Parse config files from known terminals (Ghostty, Alacritty, Kitty, WezTerm)
///   2. Query macOS app preferences (iTerm2)
///   3. Scan installed fonts for preferred Nerd Font families

/// A config file to check for a font setting.
struct ConfigProbe {
    /// Path relative to $HOME (or absolute).
    path: &'static str,
    /// How to extract the font name from the file content.
    parser: fn(&str) -> Option<String>,
}

/// Extract a `key = value` setting from a simple config file.
fn extract_key_value(content: &str, key: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') { continue; }
        if trimmed.starts_with(key) {
            if let Some(val) = trimmed.split('=').nth(1) {
                let font = val.trim().trim_matches('"').trim_matches('\'').to_string();
                if !font.is_empty() {
                    return Some(font);
                }
            }
        }
    }
    None
}

/// Parse Ghostty: `font-family = <name>`
fn parse_ghostty(content: &str) -> Option<String> {
    extract_key_value(content, "font-family")
}

/// Parse Alacritty TOML: `family = "<name>"` under `[font...]` section.
fn parse_alacritty(content: &str) -> Option<String> {
    let mut in_font = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[font") {
            in_font = true;
        } else if trimmed.starts_with('[') {
            in_font = false;
        }
        if in_font && trimmed.starts_with("family") {
            if let Some(val) = trimmed.split('=').nth(1) {
                let font = val.trim().trim_matches('"').trim_matches('\'').to_string();
                if !font.is_empty() {
                    return Some(font);
                }
            }
        }
    }
    None
}

/// Parse Kitty: `font_family <name>` (space-separated, not key=value).
fn parse_kitty(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') { continue; }
        if let Some(rest) = trimmed.strip_prefix("font_family") {
            let font = rest.trim().to_string();
            if !font.is_empty() {
                return Some(font);
            }
        }
    }
    None
}

/// Parse WezTerm Lua: extract first double-quoted string from a line
/// containing `font_family` or `font =`.
fn parse_wezterm(content: &str) -> Option<String> {
    for line in content.lines() {
        if line.contains("font_family") || line.contains("font =") {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    let font = line[start + 1..start + 1 + end].to_string();
                    if !font.is_empty() {
                        return Some(font);
                    }
                }
            }
        }
    }
    None
}

/// Try to read a config file and apply a parser. Returns None if the file
/// doesn't exist or the parser finds no font.
fn try_config(home: &str, probe: &ConfigProbe) -> Option<String> {
    let path = if probe.path.starts_with('/') {
        probe.path.to_string()
    } else {
        format!("{}/{}", home, probe.path)
    };
    let content = std::fs::read_to_string(path).ok()?;
    (probe.parser)(&content)
}

/// Config probes, checked in order. First match wins.
const CONFIG_PROBES: &[ConfigProbe] = &[
    ConfigProbe { path: ".config/ghostty/config", parser: parse_ghostty },
    ConfigProbe { path: ".config/alacritty/alacritty.toml", parser: parse_alacritty },
    ConfigProbe { path: ".alacritty.toml", parser: parse_alacritty },
    ConfigProbe { path: ".config/kitty/kitty.conf", parser: parse_kitty },
    ConfigProbe { path: ".wezterm.lua", parser: parse_wezterm },
];

/// Preferred fonts for installed-font scanning, in priority order.
/// (file name substring for matching, CSS font-family to return)
const PREFERRED_FONTS: &[(&str, &str)] = &[
    ("MesloLGS NF", "MesloLGS NF"),
    ("MesloLGS Nerd Font", "MesloLGS Nerd Font Mono"),
    ("JetBrainsMono NF", "JetBrainsMono NFM"),
    ("JetBrains Mono Nerd Font", "JetBrainsMono Nerd Font"),
    ("Hack NF", "Hack NF"),
    ("Hack Nerd Font", "Hack Nerd Font"),
    ("FiraCode NF", "FiraCode NF"),
    ("FiraCode Nerd Font", "FiraCode Nerd Font"),
    ("JetBrains Mono", "JetBrains Mono"),
    ("SF-Mono", "SF Mono"),
    ("Menlo", "Menlo"),
];

// --- macOS: query app preferences via `defaults read` ---

#[cfg(target_os = "macos")]
fn detect_iterm2_font() -> Option<String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "com.googlecode.iterm2", "New Bookmarks"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if line.contains("Normal Font") {
            // Format: key = "FontName Size"; extract font name (strip trailing size)
            let start = line.find('"')? + 1;
            let rest = &line[start..];
            let start2 = rest.find('"')? + 1;
            let rest2 = &rest[start2..];
            let end = rest2.find('"')?;
            let font_spec = &rest2[..end];
            let font = font_spec.rsplitn(2, ' ').last().unwrap_or(font_spec).to_string();
            if !font.is_empty() {
                return Some(font);
            }
        }
    }
    None
}

// --- macOS: scan installed font files ---

#[cfg(target_os = "macos")]
fn detect_installed_font_macos(home: &str) -> Option<String> {
    let font_dirs = [
        format!("{home}/Library/Fonts"),
        "/Library/Fonts".to_string(),
        "/System/Library/Fonts".to_string(),
    ];

    for &(file_hint, css_name) in PREFERRED_FONTS {
        let search_term = file_hint.replace(' ', "").to_lowercase();
        for dir in &font_dirs {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.replace(' ', "").to_lowercase().contains(&search_term) {
                        return Some(css_name.to_string());
                    }
                }
            }
        }
    }
    None
}

// --- Linux: query fc-list ---

#[cfg(not(target_os = "macos"))]
fn detect_installed_font_linux() -> Option<String> {
    let preferred = [
        "MesloLGS Nerd Font Mono",
        "MesloLGS NF",
        "JetBrainsMono Nerd Font Mono",
        "Hack Nerd Font Mono",
        "FiraCode Nerd Font Mono",
        "JetBrains Mono",
        "DejaVu Sans Mono",
    ];

    let output = std::process::Command::new("fc-list")
        .args([":spacing=100", "family"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
    for name in preferred {
        if text.contains(&name.to_lowercase()) {
            return Some(name.to_string());
        }
    }
    None
}

// --- Public API ---

/// Detect the user's preferred terminal font by probing config files and
/// system font lists. Returns a CSS font-family name, or empty string if
/// nothing was found (frontend falls back to its bundled font).
#[tauri::command]
pub async fn detect_font() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();

    // 1. Check terminal config files
    for probe in CONFIG_PROBES {
        if let Some(font) = try_config(&home, probe) {
            return Ok(font);
        }
    }

    // 2. macOS: check iTerm2 preferences
    #[cfg(target_os = "macos")]
    if let Some(font) = detect_iterm2_font() {
        return Ok(font);
    }

    // 3. Scan installed fonts
    #[cfg(target_os = "macos")]
    if let Some(font) = detect_installed_font_macos(&home) {
        return Ok(font);
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(font) = detect_installed_font_linux() {
        return Ok(font);
    }

    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ghostty_finds_font() {
        let config = "# Ghostty config\nfont-family = JetBrains Mono\nfont-size = 14\n";
        assert_eq!(parse_ghostty(config), Some("JetBrains Mono".into()));
    }

    #[test]
    fn parse_ghostty_skips_comments() {
        let config = "# font-family = Nope\nfont-family = Hack\n";
        assert_eq!(parse_ghostty(config), Some("Hack".into()));
    }

    #[test]
    fn parse_alacritty_finds_font_in_section() {
        let config = "[font.normal]\nfamily = \"FiraCode NF\"\nstyle = \"Regular\"\n";
        assert_eq!(parse_alacritty(config), Some("FiraCode NF".into()));
    }

    #[test]
    fn parse_alacritty_ignores_family_outside_font_section() {
        let config = "[colors]\nfamily = NotAFont\n[font]\nfamily = \"RealFont\"\n";
        assert_eq!(parse_alacritty(config), Some("RealFont".into()));
    }

    #[test]
    fn parse_kitty_finds_font() {
        let config = "# kitty config\nfont_family MesloLGS NF\nbold_font auto\n";
        assert_eq!(parse_kitty(config), Some("MesloLGS NF".into()));
    }

    #[test]
    fn parse_kitty_skips_commented_line() {
        let config = "# font_family Nope\nfont_family Hack Nerd Font\n";
        assert_eq!(parse_kitty(config), Some("Hack Nerd Font".into()));
    }

    #[test]
    fn parse_wezterm_finds_font() {
        let config = r#"config.font = wezterm.font("JetBrains Mono")"#;
        assert_eq!(parse_wezterm(config), Some("JetBrains Mono".into()));
    }

    #[test]
    fn parse_wezterm_finds_font_family_key() {
        let config = r#"font_family = "MesloLGS NF""#;
        assert_eq!(parse_wezterm(config), Some("MesloLGS NF".into()));
    }

    #[test]
    fn extract_key_value_basic() {
        assert_eq!(extract_key_value("foo = bar\n", "foo"), Some("bar".into()));
    }

    #[test]
    fn extract_key_value_quoted() {
        assert_eq!(extract_key_value("key = \"value\"\n", "key"), Some("value".into()));
    }

    #[test]
    fn extract_key_value_empty() {
        assert_eq!(extract_key_value("key = \n", "key"), None);
    }
}
