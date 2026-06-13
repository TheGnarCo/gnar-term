use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::path_security::{
    is_blocked_path, path_is_blocked, validate_read_path, validate_write_path,
};
use crate::state::{AppState, FileChanged, NEXT_WATCH_ID};

/// List filenames in a directory (non-recursive, files only)
#[tauri::command]
pub(crate) async fn list_dir(path: String) -> Result<Vec<String>, String> {
    if path_is_blocked(&path) {
        return Err(format!("Access denied: {}", path));
    }
    let entries = std::fs::read_dir(&path).map_err(|e| format!("Failed to read dir {}: {}", path, e))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if is_blocked_path(&entry.path().to_string_lossy()) {
            continue;
        }
        if let Ok(ft) = entry.file_type() {
            if ft.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
    }
    Ok(names)
}

/// Read a file's contents
#[tauri::command]
pub(crate) async fn read_file(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    std::fs::read_to_string(&validated).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Directory entry metadata for the MCP `list_dir` tool.
#[derive(Clone, Serialize)]
pub(crate) struct McpDirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

/// List a directory as a vector of entries with type + size metadata.
/// Unlike `list_dir` (which returns only file names) this returns directories
/// and files so the CWD File Navigator can render a tree.
#[tauri::command]
pub(crate) async fn mcp_list_dir(
    path: String,
    include_hidden: Option<bool>,
) -> Result<Vec<McpDirEntry>, String> {
    let include_hidden = include_hidden.unwrap_or(false);
    if path_is_blocked(&path) {
        return Err(format!("Access denied: {}", path));
    }
    let entries = std::fs::read_dir(&path)
        .map_err(|e| format!("Failed to read dir {}: {}", path, e))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        let entry_path = entry.path().to_string_lossy().to_string();
        if is_blocked_path(&entry_path) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(McpDirEntry {
            name,
            path: entry_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    // Stable ordering: directories first, then files, alphabetic within.
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(out)
}

/// Return `(exists, is_dir)` for the MCP `file_exists` tool. Blocked paths
/// report as non-existent so an agent can't probe for sensitive files.
#[tauri::command]
pub(crate) async fn mcp_file_info(path: String) -> (bool, bool) {
    if path_is_blocked(&path) {
        return (false, false);
    }
    match std::fs::metadata(&path) {
        Ok(m) => (true, m.is_dir()),
        Err(_) => (false, false),
    }
}

/// Read a file as base64 (for binary files like images)
#[tauri::command]
pub(crate) async fn read_file_base64(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    let bytes = std::fs::read(&validated).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    Ok(b64_encode(&bytes))
}

pub(crate) fn b64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(triple & 0x3F) as usize] as char); } else { result.push('='); }
    }
    result
}

/// Write content to a file
#[tauri::command]
pub(crate) async fn write_file(path: String, content: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// Ensure a directory exists
#[tauri::command]
pub(crate) async fn ensure_dir(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {}: {}", path, e))
}

/// Get the user's home directory
#[tauri::command]
pub(crate) async fn get_home() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "HOME not set".to_string())
}

/// Show a file in the system file manager
#[tauri::command]
pub(crate) async fn show_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").args(["-R", &path]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path);
        std::process::Command::new("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        let canonical = std::fs::canonicalize(&path).map_err(|e| format!("Invalid path: {}", e))?;
        std::process::Command::new("explorer").args(["/select,", &canonical.to_string_lossy()]).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a file with the default system app
#[tauri::command]
pub(crate) async fn open_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Watch a file for changes, emit events
#[tauri::command]
pub(crate) async fn watch_file(app: AppHandle, state: tauri::State<'_, AppState>, path: String) -> Result<u32, String> {
    let watch_id = NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();

    state.watch_flags.lock().map_err(|e| e.to_string())?.insert(watch_id, stop);

    let path_clone = path.clone();
    std::thread::spawn(move || {
        let mut last_modified = std::fs::metadata(&path_clone)
            .and_then(|m| m.modified())
            .ok();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if stop_clone.load(Ordering::Relaxed) {
                break;
            }
            let current = std::fs::metadata(&path_clone)
                .and_then(|m| m.modified())
                .ok();
            if current != last_modified {
                last_modified = current;
                if let Ok(content) = std::fs::read_to_string(&path_clone) {
                    let _ = app.emit("file-changed", FileChanged { watch_id, path: path_clone.clone(), content });
                }
            }
        }
    });
    Ok(watch_id)
}

/// Stop watching a file
#[tauri::command]
pub(crate) async fn unwatch_file(state: tauri::State<'_, AppState>, watch_id: u32) -> Result<(), String> {
    let mut flags = state.watch_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.remove(&watch_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Find a file by name using platform-specific search
#[tauri::command]
pub(crate) async fn find_file(name: String) -> Result<String, String> {
    // macOS: use Spotlight (mdfind) — fast indexed search
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("mdfind")
            .args(["-name", &name])
            .output()
            .map_err(|e| format!("mdfind failed: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.starts_with('/') && line.ends_with(&name) {
                return Ok(line.to_string());
            }
        }
    }
    // Linux: use locate (if available) then fall back to find in home
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("locate")
            .args(["-l", "1", &name])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                if line.starts_with('/') {
                    return Ok(line.to_string());
                }
            }
        }
        // Fall back to find in home directory
        let home = std::env::var("HOME").unwrap_or_default();
        if let Ok(output) = std::process::Command::new("find")
            .args([&home, "-maxdepth", "4", "-name", &name, "-print", "-quit"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                if line.starts_with('/') {
                    return Ok(line.to_string());
                }
            }
        }
    }
    Err(format!("File not found: {}", name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path_security::{is_blocked_path, validate_read_path, validate_write_path};
    use crate::state::{AppState, NEXT_WATCH_ID};
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[tokio::test]
    async fn mcp_file_info_hides_sensitive_paths() {
        // The MCP-facing metadata tool must enforce the same blocklist as
        // file_exists — otherwise an agent could probe for ~/.ssh/id_rsa.
        let home = std::env::var("HOME").unwrap();
        let ssh = format!("{}/.ssh/id_rsa", home);
        assert_eq!(
            mcp_file_info(ssh).await,
            (false, false),
            "mcp_file_info must report blocked paths as non-existent"
        );
    }

    #[tokio::test]
    async fn mcp_list_dir_blocks_sensitive_directory() {
        let home = std::env::var("HOME").unwrap();
        let ssh_dir = format!("{}/.ssh", home);
        assert!(
            mcp_list_dir(ssh_dir, Some(true)).await.is_err(),
            "mcp_list_dir must deny listing a blocked directory"
        );
    }

    #[tokio::test]
    async fn list_dir_blocks_sensitive_directory() {
        let home = std::env::var("HOME").unwrap();
        let ssh_dir = format!("{}/.ssh", home);
        assert!(
            list_dir(ssh_dir).await.is_err(),
            "list_dir must deny listing a blocked directory"
        );
    }

    #[tokio::test]
    async fn mcp_list_dir_filters_blocked_entries() {
        // Listing $HOME (with hidden entries) must not surface blocked
        // children like .ssh / .aws / .bash_history.
        let home = std::env::var("HOME").unwrap();
        if let Ok(entries) = mcp_list_dir(home.clone(), Some(true)).await {
            for e in &entries {
                assert!(
                    !is_blocked_path(&e.path),
                    "mcp_list_dir leaked blocked entry: {}",
                    e.path
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // File read/write roundtrip (T4)
    // -----------------------------------------------------------------------

    #[test]
    fn file_read_write_roundtrip() {
        let home = std::env::var("HOME").unwrap();
        let config_dir = format!("{}/.config/gnar-term/test-tmp", home);
        std::fs::create_dir_all(&config_dir).expect("Failed to create test dir");

        let test_path = format!("{}/roundtrip_test.txt", config_dir);
        let content = "Hello from GnarTerm integration test!\nLine 2\nLine 3 with unicode: \u{1F680}";

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
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
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
                if iterations > 100 {
                    panic!("Watcher thread did not stop within timeout");
                }
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
        watcher_handle.join().expect("Watcher thread should stop without panic");

        // Flag should no longer be in the map
        assert!(!state.watch_flags.lock().unwrap().contains_key(&watch_id),
            "Watch flag should be removed after unwatch");
    }

    // -----------------------------------------------------------------------
    // Base64 encoding (T6)
    // -----------------------------------------------------------------------

    #[test]
    fn b64_encode_empty() {
        assert_eq!(b64_encode(b""), "");
    }

    #[test]
    fn b64_encode_single_byte() {
        // 'A' (0x41) -> base64 "QQ=="
        assert_eq!(b64_encode(b"A"), "QQ==");
    }

    #[test]
    fn b64_encode_two_bytes() {
        // "AB" -> base64 "QUI="
        assert_eq!(b64_encode(b"AB"), "QUI=");
    }

    #[test]
    fn b64_encode_three_bytes() {
        // "ABC" -> base64 "QUJD"
        assert_eq!(b64_encode(b"ABC"), "QUJD");
    }

    #[test]
    fn b64_encode_hello_world() {
        assert_eq!(b64_encode(b"Hello, World!"), "SGVsbG8sIFdvcmxkIQ==");
    }

    #[test]
    fn b64_encode_terminal_escape_sequences() {
        // ESC[31m = red color code
        let ansi_red = b"\x1b[31mHello\x1b[0m";
        let encoded = b64_encode(ansi_red);
        // Verify it's valid base64 and round-trips correctly
        assert!(!encoded.is_empty());
        assert!(encoded.len() % 4 == 0, "Base64 output length should be multiple of 4");
        // Known base64 for this sequence
        assert_eq!(encoded, "G1szMW1IZWxsbxtbMG0=");
    }

    #[test]
    fn b64_encode_binary_data() {
        // All byte values 0x00..0xFF
        let data: Vec<u8> = (0..=255).collect();
        let encoded = b64_encode(&data);
        assert!(!encoded.is_empty());
        assert!(encoded.len() % 4 == 0, "Base64 output should be padded to multiple of 4");
    }

    // -----------------------------------------------------------------------
    // Ensure dir (T7)
    // -----------------------------------------------------------------------

    #[test]
    fn ensure_dir_creates_nested_directory() {
        let home = std::env::var("HOME").unwrap();
        let test_dir = format!("{}/.config/gnar-term/test-tmp/nested/deep/dir", home);

        // Remove if leftover from a previous run
        let _ = std::fs::remove_dir_all(format!("{}/.config/gnar-term/test-tmp/nested", home));

        // validate_write_path should allow it
        validate_write_path(&test_dir).expect("Path should be valid under config dir");

        // Create it (same logic as ensure_dir command)
        std::fs::create_dir_all(&test_dir).expect("Should create nested dirs");
        assert!(std::path::Path::new(&test_dir).is_dir(), "Directory should exist");

        // Cleanup
        let _ = std::fs::remove_dir_all(format!("{}/.config/gnar-term/test-tmp/nested", home));
    }

    // -----------------------------------------------------------------------
    // Home directory (T8)
    // -----------------------------------------------------------------------

    #[test]
    fn get_home_returns_valid_path() {
        // Same logic as get_home command
        let home = std::env::var("HOME").expect("HOME should be set in test env");
        assert!(!home.is_empty(), "HOME should not be empty");
        assert!(home.starts_with('/'), "HOME should be an absolute path, got: {}", home);
        assert!(std::path::Path::new(&home).is_dir(), "HOME should point to an existing directory");
    }
}
