use crate::{
    b64_encode, home_dir, validate_read_path, validate_write_path, AppState, NEXT_WATCH_ID,
};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Directory entry with metadata for the file browser
#[derive(Serialize)]
pub(crate) struct DirEntry {
    name: String,
    is_dir: bool,
    is_hidden: bool,
}

#[derive(Clone, Serialize)]
struct FileChanged {
    watch_id: u32,
    path: String,
    content: String,
}

/// Detect the user's terminal font by reading existing terminal configs
#[tauri::command]
pub(crate) async fn detect_font() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();

    // 1. Ghostty config
    let ghostty_path = format!("{home}/.config/ghostty/config");
    if let Ok(content) = std::fs::read_to_string(&ghostty_path) {
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with("font-family") {
                if let Some(val) = line.split('=').nth(1) {
                    let font = val.trim().to_string();
                    if !font.is_empty() {
                        return Ok(font);
                    }
                }
            }
        }
    }

    // 2. Alacritty config (TOML)
    for path in [
        format!("{home}/.config/alacritty/alacritty.toml"),
        format!("{home}/.alacritty.toml"),
    ] {
        if let Ok(content) = std::fs::read_to_string(&path) {
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
                            return Ok(font);
                        }
                    }
                }
            }
        }
    }

    // 3. Kitty config
    let kitty_path = format!("{home}/.config/kitty/kitty.conf");
    if let Ok(content) = std::fs::read_to_string(&kitty_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("font_family") && !trimmed.starts_with('#') {
                let font = trimmed
                    .strip_prefix("font_family")
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !font.is_empty() {
                    return Ok(font);
                }
            }
        }
    }

    // 4. WezTerm config (Lua — best effort)
    let wez_path = format!("{home}/.wezterm.lua");
    if let Ok(content) = std::fs::read_to_string(&wez_path) {
        for line in content.lines() {
            if line.contains("font_family") || line.contains("font =") {
                // Extract quoted string
                if let Some(start) = line.find('"') {
                    if let Some(end) = line[start + 1..].find('"') {
                        let font = line[start + 1..start + 1 + end].to_string();
                        if !font.is_empty() {
                            return Ok(font);
                        }
                    }
                }
            }
        }
    }

    // 5. iTerm2 (macOS) — read from defaults
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("defaults")
            .args(["read", "com.googlecode.iterm2", "New Bookmarks"])
            .output();
        if let Ok(o) = output {
            let text = String::from_utf8_lossy(&o.stdout);
            // Look for "Normal Font" = "<FontName> <Size>";
            for line in text.lines() {
                if line.contains("Normal Font") {
                    if let Some(start) = line.find('"') {
                        let rest = &line[start + 1..];
                        if let Some(start2) = rest.find('"') {
                            let rest2 = &rest[start2 + 1..];
                            if let Some(end) = rest2.find('"') {
                                let font_spec = &rest2[..end];
                                // Format is "FontName Size" — strip the size
                                let font = font_spec
                                    .rsplitn(2, ' ')
                                    .last()
                                    .unwrap_or(font_spec)
                                    .to_string();
                                if !font.is_empty() {
                                    return Ok(font);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 6. macOS Terminal.app
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("defaults")
            .args(["read", "com.apple.Terminal", "Default Window Settings"])
            .output();
        if let Ok(o) = output {
            let profile = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !profile.is_empty() {
                let font_output = std::process::Command::new("defaults")
                    .args(["read", "com.apple.Terminal", "Window Settings"])
                    .output();
                if let Ok(fo) = font_output {
                    let text = String::from_utf8_lossy(&fo.stdout);
                    for line in text.lines() {
                        if line.contains("Font") && line.contains("data") {
                            // Font is stored as NSData, too complex to parse
                            // Fall through to system font detection
                            break;
                        }
                    }
                }
            }
        }
    }

    // 7. Check what monospace/nerd fonts are actually installed
    #[cfg(target_os = "macos")]
    {
        // Faster check via font file existence
        let font_dirs = [
            format!("{home}/Library/Fonts"),
            "/Library/Fonts".to_string(),
            "/System/Library/Fonts".to_string(),
        ];

        // (File name substring, CSS font-family name)
        let preferred = [
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

        for (file_hint, css_name) in preferred {
            let search_term = file_hint.replace(' ', "").to_lowercase();
            for dir in &font_dirs {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        let name_lower = file_name.replace(' ', "").to_lowercase();
                        if name_lower.contains(&search_term) {
                            return Ok(css_name.to_string());
                        }
                    }
                }
            }
        }
    }

    // 7b. Linux — use fc-list
    #[cfg(not(target_os = "macos"))]
    {
        let preferred = [
            "MesloLGS Nerd Font Mono",
            "MesloLGS NF",
            "JetBrainsMono Nerd Font Mono",
            "Hack Nerd Font Mono",
            "FiraCode Nerd Font Mono",
            "JetBrains Mono",
            "DejaVu Sans Mono",
        ];

        if let Ok(output) = std::process::Command::new("fc-list")
            .args([":spacing=100", "family"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
            for font_name in preferred {
                if text.contains(&font_name.to_lowercase()) {
                    return Ok(font_name.to_string());
                }
            }
        }
    }

    // 8. Nothing found — return empty, frontend uses platform default
    Ok(String::new())
}

/// List installed monospace fonts available for terminal use
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
                    // Only look at font files
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
        // Linux — fc-list gives actual monospace fonts
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

/// Check if a file exists (lightweight — no read)
#[tauri::command]
pub(crate) async fn file_exists(path: String) -> bool {
    match validate_read_path(&path) {
        Ok(validated) => validated.exists(),
        Err(_) => false,
    }
}

/// List entries in a directory (non-recursive, files and directories)
#[tauri::command]
pub(crate) async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let validated = validate_read_path(&path)?;
    let entries =
        std::fs::read_dir(&validated).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
    let mut result = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            let is_hidden = name.starts_with('.');
            result.push(DirEntry {
                name: name.to_string(),
                is_dir,
                is_hidden,
            });
        }
    }
    // Sort: directories first, then alphabetical (case-insensitive)
    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(result)
}

/// Check if a path is inside a git repository
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

/// List gitignored files in a directory using `git check-ignore`
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

/// Read a file's contents
#[tauri::command]
pub(crate) async fn read_file(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    std::fs::read_to_string(&validated).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Read a file as base64 (for binary files like images)
#[tauri::command]
pub(crate) async fn read_file_base64(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    let bytes = std::fs::read(&validated).map_err(|e| format!("Failed to read {path}: {e}"))?;
    Ok(b64_encode(&bytes))
}

/// Write content to a file
#[tauri::command]
pub(crate) async fn write_file(path: String, content: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Ensure a directory exists
#[tauri::command]
pub(crate) async fn ensure_dir(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {path}: {e}"))
}

/// Remove a directory and all its contents (restricted to ~/.config/gnar-term/)
#[tauri::command]
pub(crate) async fn remove_dir(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    if std::path::Path::new(&path).exists() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("Failed to remove {path}: {e}"))
    } else {
        Ok(())
    }
}

/// Get the user's home directory
#[tauri::command]
pub(crate) async fn get_home() -> Result<String, String> {
    home_dir()
}

/// Show a file in the system file manager
#[tauri::command]
pub(crate) async fn show_in_file_manager(path: String) -> Result<(), String> {
    let validated = validate_read_path(&path)?;
    let validated_str = validated.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &validated_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = validated
            .parent()
            .map_or(validated_str, |p| p.to_string_lossy().to_string());
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &validated_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a file with the default system app
#[tauri::command]
pub(crate) async fn open_with_default_app(path: String) -> Result<(), String> {
    let validated = validate_read_path(&path)?;
    let validated_str = validated.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&validated_str)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&validated_str)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&validated_str)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Watch a file for changes, emit events
#[tauri::command]
pub(crate) async fn watch_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<u32, String> {
    // Validate the path before watching — prevent exfiltration of sensitive files
    let validated = validate_read_path(&path)?;
    let validated_str = validated.to_string_lossy().to_string();

    let watch_id = NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();

    state
        .watch_flags
        .lock()
        .map_err(|e| e.to_string())?
        .insert(watch_id, stop);

    // Cap file content emitted over IPC to prevent UI stalls on large files
    const MAX_WATCH_FILE_SIZE: u64 = 512 * 1024; // 512KB

    std::thread::spawn(move || {
        let mut last_modified = std::fs::metadata(&validated_str)
            .and_then(|m| m.modified())
            .ok();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if stop_clone.load(Ordering::Relaxed) {
                break;
            }
            let current = std::fs::metadata(&validated_str)
                .and_then(|m| m.modified())
                .ok();
            if current != last_modified {
                last_modified = current;
                // Emit content for small files; emit empty content for oversized files
                // so the frontend knows the file changed even if content is too large
                let size = std::fs::metadata(&validated_str)
                    .map(|m| m.len())
                    .unwrap_or(0);
                if size <= MAX_WATCH_FILE_SIZE {
                    if let Ok(content) = std::fs::read_to_string(&validated_str) {
                        let _ = app.emit(
                            "file-changed",
                            FileChanged {
                                watch_id,
                                path: validated_str.clone(),
                                content,
                            },
                        );
                    }
                } else {
                    let _ = app.emit(
                        "file-changed",
                        FileChanged {
                            watch_id,
                            path: validated_str.clone(),
                            content: String::new(),
                        },
                    );
                }
            }
        }
    });
    Ok(watch_id)
}

/// Stop watching a file
#[tauri::command]
pub(crate) async fn unwatch_file(
    state: tauri::State<'_, AppState>,
    watch_id: u32,
) -> Result<(), String> {
    let mut flags = state.watch_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.remove(&watch_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Find a file by name using platform-specific search
#[tauri::command]
pub(crate) async fn find_file(name: String) -> Result<String, String> {
    // Validate name: reject path separators and leading hyphens to prevent
    // flag injection in mdfind/locate/find and path traversal
    if name.is_empty() || name.starts_with('-') || name.contains('/') || name.contains('\\') {
        return Err(
            "Invalid file name: must not be empty, start with '-', or contain path separators"
                .to_string(),
        );
    }
    // macOS: use Spotlight (mdfind) — fast indexed search
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("mdfind")
            .args(["-name", &name])
            .output()
            .map_err(|e| format!("mdfind failed: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.starts_with('/') && line.ends_with(&name) && validate_read_path(line).is_ok() {
                return Ok(line.to_string());
            }
        }
    }
    // Linux: use locate (if available) then fall back to find in home
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("locate")
            .args(["-l", "10", "-b", &name])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with('/') && validate_read_path(line).is_ok() {
                    return Ok(line.to_string());
                }
            }
        }
        // Fall back to find in home directory
        let home = std::env::var("HOME").unwrap_or_default();
        if let Ok(output) = std::process::Command::new("find")
            .args([&home, "-maxdepth", "4", "-name", &name, "-print"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with('/') && validate_read_path(line).is_ok() {
                    return Ok(line.to_string());
                }
            }
        }
    }
    Err(format!("File not found: {name}"))
}

// ----- MCP file-system tools -----

#[derive(Serialize)]
pub(crate) struct McpDirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

/// Richer directory listing for MCP file-system tools (returns type + size
/// metadata; `list_dir` returns only file names).
#[tauri::command]
pub(crate) async fn mcp_list_dir(
    path: String,
    include_hidden: Option<bool>,
) -> Result<Vec<McpDirEntry>, String> {
    let include_hidden = include_hidden.unwrap_or(false);
    let entries =
        std::fs::read_dir(&path).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let entry_path = entry.path().to_string_lossy().to_string();
        out.push(McpDirEntry {
            name,
            path: entry_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(out)
}

/// Return `(exists, is_dir)` for the MCP `file_exists` tool.
#[tauri::command]
pub(crate) async fn mcp_file_info(path: String) -> (bool, bool) {
    match std::fs::metadata(&path) {
        Ok(m) => (true, m.is_dir()),
        Err(_) => (false, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate_write_path;
    use std::sync::Mutex;
    use std::time::Duration;

    // -----------------------------------------------------------------------
    // File read/write roundtrip (T4)
    // -----------------------------------------------------------------------

    #[test]
    fn file_read_write_roundtrip() {
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let config_dir = format!("{home}/.config/gnar-term/test-tmp");
        std::fs::create_dir_all(&config_dir).expect("Failed to create test dir");

        let test_path = format!("{config_dir}/roundtrip_test.txt");
        let content =
            "Hello from GnarTerm integration test!\nLine 2\nLine 3 with unicode: \u{1F680}";

        // Write via validate_write_path + fs::write (same as write_file command)
        validate_write_path(&test_path).expect("Write path should be valid");
        std::fs::write(&test_path, content).expect("Failed to write file");

        // Read back via validate_read_path + fs::read_to_string (same as read_file command)
        let validated = validate_read_path(&test_path).expect("Read path should be valid");
        let read_back = std::fs::read_to_string(&validated).expect("Failed to read file");

        assert_eq!(read_back, content, "Content should match after roundtrip");

        // Cleanup
        let _ = std::fs::remove_file(&test_path);
        let _ = std::fs::remove_dir(&config_dir);
    }

    // -----------------------------------------------------------------------
    // File watcher with cancellation (T5)
    // -----------------------------------------------------------------------

    #[test]
    fn file_watcher_cancellation_sets_stop_flag() {
        let state = AppState {
            ptys: Mutex::new(std::collections::HashMap::new()),
            watch_flags: Mutex::new(std::collections::HashMap::new()),
        };

        let watch_id = NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();

        // Insert the watcher flag (same as watch_file does)
        state.watch_flags.lock().unwrap().insert(watch_id, stop);

        // Spawn a mock watcher thread that checks the flag
        let watcher_handle = std::thread::spawn(move || {
            let mut iterations = 0;
            loop {
                std::thread::sleep(Duration::from_millis(10));
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                iterations += 1;
                assert!(
                    iterations <= 100,
                    "Watcher thread did not stop within timeout"
                );
            }
        });

        // Simulate unwatch: remove flag and set it to true
        std::thread::sleep(Duration::from_millis(30));
        {
            let mut flags = state.watch_flags.lock().unwrap();
            if let Some(flag) = flags.remove(&watch_id) {
                flag.store(true, Ordering::Relaxed);
            }
        }

        // Watcher thread should exit cleanly
        watcher_handle
            .join()
            .expect("Watcher thread should stop without panic");

        // Flag should no longer be in the map
        assert!(
            !state.watch_flags.lock().unwrap().contains_key(&watch_id),
            "Watch flag should be removed after unwatch"
        );
    }

    // -----------------------------------------------------------------------
    // Ensure dir (T7)
    // -----------------------------------------------------------------------

    #[test]
    fn ensure_dir_creates_nested_directory() {
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let config_dir = format!("{home}/.config/gnar-term");
        let test_dir = format!("{config_dir}/test-tmp/nested/deep/dir");

        // Ensure the config root exists (CI runners start with a bare $HOME)
        std::fs::create_dir_all(&config_dir).expect("Should create config dir");

        // Remove if leftover from a previous run
        let _ = std::fs::remove_dir_all(format!("{config_dir}/test-tmp/nested"));

        // validate_write_path should allow it
        validate_write_path(&test_dir).expect("Path should be valid under config dir");

        // Create it (same logic as ensure_dir command)
        std::fs::create_dir_all(&test_dir).expect("Should create nested dirs");
        assert!(
            std::path::Path::new(&test_dir).is_dir(),
            "Directory should exist"
        );

        // Cleanup
        let _ = std::fs::remove_dir_all(format!("{home}/.config/gnar-term/test-tmp/nested"));
    }

    // -----------------------------------------------------------------------
    // Home directory (T8)
    // -----------------------------------------------------------------------

    #[test]
    fn get_home_returns_valid_path() {
        // Same logic as get_home command
        let home = std::env::var("HOME").expect("HOME should be set in test env");
        assert!(!home.is_empty(), "HOME should not be empty");
        assert!(
            home.starts_with('/'),
            "HOME should be an absolute path, got: {home}"
        );
        assert!(
            std::path::Path::new(&home).is_dir(),
            "HOME should point to an existing directory"
        );
    }
}
