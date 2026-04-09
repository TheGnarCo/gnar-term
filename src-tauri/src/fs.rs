use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use crate::b64;

pub static NEXT_WATCH_ID: AtomicU32 = AtomicU32::new(1);

/// Block reads to sensitive directories (SSH keys, credentials, etc.)
pub fn validate_read_path(path: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Invalid path {}: {}", path, e))?;
    let path_str = canonical.to_string_lossy();

    if let Ok(home) = std::env::var("HOME") {
        let blocked = ["/.ssh", "/.gnupg", "/.aws", "/.kube", "/.config/gcloud", "/.docker"];
        for prefix in blocked {
            if path_str.starts_with(&format!("{}{}", home, prefix)) {
                return Err(format!("Access denied: {}", path));
            }
        }
    }
    if path_str.starts_with("/etc/shadow") || path_str.starts_with("/etc/gshadow") {
        return Err(format!("Access denied: {}", path));
    }
    Ok(canonical)
}

/// Validate that a write path is under ~/.config/gnar/
pub fn validate_write_path(path: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let allowed = format!("{}/.config/gnar", home);

    let mut resolved = Vec::new();
    for component in std::path::Path::new(path).components() {
        match component {
            std::path::Component::ParentDir => { resolved.pop(); }
            std::path::Component::CurDir => {}
            c => resolved.push(c),
        }
    }
    let norm_path: std::path::PathBuf = resolved.into_iter().collect();
    let norm_allowed = std::path::Path::new(&allowed).components().collect::<std::path::PathBuf>();

    if !norm_path.starts_with(&norm_allowed) {
        return Err(format!("Write denied: path must be under {}", allowed));
    }
    Ok(())
}

/// Check if a file exists (lightweight — no read)
#[tauri::command]
pub async fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// List filenames in a directory (non-recursive, files only)
#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| format!("Failed to read dir {}: {}", path, e))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
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

/// Recursively list all non-hidden files under a directory, returning paths relative to root.
/// Skips directories and files whose names start with '.'.
#[tauri::command]
pub async fn list_files_recursive(path: String) -> Result<Vec<String>, String> {
    let root = std::path::Path::new(&path);
    let mut result = Vec::new();
    list_files_walk(root, root, &mut result)?;
    result.sort();
    Ok(result)
}

fn list_files_walk(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<String>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') { continue; }
        if let Ok(ft) = entry.file_type() {
            let rel = entry.path().strip_prefix(root).unwrap_or(&entry.path()).to_string_lossy().to_string();
            if ft.is_file() {
                out.push(rel);
            } else if ft.is_dir() {
                list_files_walk(root, &entry.path(), out)?;
            }
        }
    }
    Ok(())
}

/// Read a file's contents
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    std::fs::read_to_string(&validated).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Read a file as base64 (for binary files like images)
#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    let bytes = std::fs::read(&validated).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    Ok(b64::encode(&bytes))
}

/// Write content to a file
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

/// Ensure a directory exists
#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {}: {}", path, e))
}

/// Get the user's home directory
#[tauri::command]
pub async fn get_home() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "HOME not set".to_string())
}

/// Show a file in the system file manager
#[tauri::command]
pub async fn show_in_file_manager(path: String) -> Result<(), String> {
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
pub async fn open_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Clone, Serialize)]
pub struct FileChanged {
    pub watch_id: u32,
    pub path: String,
    pub content: String,
}

/// Watch a file for changes, emit events
#[tauri::command]
pub async fn watch_file(app: AppHandle, state: tauri::State<'_, crate::AppState>, path: String) -> Result<u32, String> {
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
pub async fn unwatch_file(state: tauri::State<'_, crate::AppState>, watch_id: u32) -> Result<(), String> {
    let mut flags: std::sync::MutexGuard<'_, HashMap<u32, Arc<AtomicBool>>> = state.watch_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.remove(&watch_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Find a file by name using platform-specific search
#[tauri::command]
pub async fn find_file(name: String) -> Result<String, String> {
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
