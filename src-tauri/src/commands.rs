use crate::validate_read_path;

/// List installed monospace fonts available for terminal use.
#[tauri::command]
pub(crate) async fn list_monospace_fonts() -> Result<Vec<String>, String> {
    let mut fonts = std::collections::BTreeSet::new();

    // Always include the bundled font
    fonts.insert("JetBrainsMono Nerd Font Mono".to_string());

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let font_dirs = [
            format!("{home}/Library/Fonts"),
            "/Library/Fonts".to_string(),
            "/System/Library/Fonts".to_string(),
            "/System/Library/Fonts/Supplemental".to_string(),
        ];

        // (File name substring, CSS font-family name)
        let known_monospace: &[(&str, &str)] = &[
            ("MesloLGS NF", "MesloLGS NF"),
            ("MesloLGS Nerd Font", "MesloLGS Nerd Font Mono"),
            ("JetBrainsMono NF", "JetBrainsMono NFM"),
            ("JetBrains Mono Nerd Font", "JetBrainsMono Nerd Font Mono"),
            ("JetBrainsMono-", "JetBrains Mono"),
            ("Hack NF", "Hack NF"),
            ("Hack Nerd Font", "Hack Nerd Font Mono"),
            ("Hack-", "Hack"),
            ("FiraCode NF", "FiraCode NF"),
            ("FiraCode Nerd Font", "FiraCode Nerd Font Mono"),
            ("FiraCode-", "Fira Code"),
            ("SourceCodePro", "Source Code Pro"),
            ("IBMPlexMono", "IBM Plex Mono"),
            ("RobotoMono", "Roboto Mono"),
            ("UbuntuMono", "Ubuntu Mono"),
            ("Inconsolata", "Inconsolata"),
            ("CascadiaCode", "Cascadia Code"),
            ("CascadiaMono", "Cascadia Mono"),
            ("VictorMono", "Victor Mono"),
            ("Iosevka", "Iosevka"),
            ("MonoLisa", "MonoLisa"),
            ("DankMono", "Dank Mono"),
            ("OperatorMono", "Operator Mono"),
            ("SF-Mono", "SF Mono"),
            ("SFMono", "SF Mono"),
            ("Menlo", "Menlo"),
            ("Monaco", "Monaco"),
            ("Courier", "Courier New"),
            ("AnonymousPro", "Anonymous Pro"),
            ("Consolas", "Consolas"),
        ];

        for dir in &font_dirs {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    let lower = file_name.to_lowercase();
                    if !lower.ends_with(".ttf")
                        && !lower.ends_with(".otf")
                        && !lower.ends_with(".ttc")
                    {
                        continue;
                    }
                    let name_normalized = file_name.replace(' ', "");
                    for (hint, css_name) in known_monospace {
                        let search = hint.replace(' ', "");
                        if name_normalized.contains(&search) {
                            fonts.insert(css_name.to_string());
                            break;
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Ok(output) = std::process::Command::new("fc-list")
            .args([":spacing=100", "family"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let family = line.split(',').next().unwrap_or("").trim().to_string();
                if !family.is_empty() {
                    fonts.insert(family);
                }
            }
        }
    }

    Ok(fonts.into_iter().collect())
}

/// Check if a path is inside a git repository.
#[tauri::command]
pub(crate) async fn is_git_repo(path: String) -> Result<bool, String> {
    let validated = validate_read_path(&path)?;
    let mut dir = std::path::PathBuf::from(&validated);
    loop {
        if dir.join(".git").exists() {
            return Ok(true);
        }
        if !dir.pop() {
            return Ok(false);
        }
    }
}

/// List gitignored filenames in a directory via `git check-ignore`.
#[tauri::command]
pub(crate) async fn list_gitignored(path: String) -> Result<Vec<String>, String> {
    let validated = validate_read_path(&path)?;
    let entries =
        std::fs::read_dir(&validated).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
    let names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(std::string::ToString::to_string))
        .collect();
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let output = std::process::Command::new("git")
        .arg("check-ignore")
        .arg("--")
        .args(&names)
        .current_dir(&validated)
        .output()
        .map_err(|e| format!("git check-ignore failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(std::string::ToString::to_string)
        .collect())
}

/// Remove a directory and all its contents (restricted to the write-allowlist).
#[tauri::command]
pub(crate) async fn remove_dir(path: String) -> Result<(), String> {
    crate::validate_write_path(&path)?;
    if std::path::Path::new(&path).exists() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove {path}: {e}"))
    } else {
        Ok(())
    }
}
