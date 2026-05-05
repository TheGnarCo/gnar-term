//! File-watching commands.
//!
//! Each watcher is a polling thread guarded by an `AtomicBool` stop flag
//! stored in `AppState.watch_flags`. The `unwatch_*` commands flip the flag
//! and the thread exits on the next tick. Watchers cap payload size at
//! `MAX_WATCH_FILE_SIZE` to keep oversized files from flooding the event bus.

use crate::{validate_claude_read, validate_read_path, AppState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub(crate) static NEXT_WATCH_ID: AtomicU32 = AtomicU32::new(1);

/// Settings/config files are small; cap payloads to keep the event bus
/// honest if an unexpectedly large file lands under a watched path.
const MAX_WATCH_FILE_SIZE: u64 = 512 * 1024;

#[derive(Clone, Serialize)]
pub(crate) struct FileChanged {
    watch_id: u32,
    path: String,
    content: String,
}

/// Shared polling loop for `watch_file` and `watch_claude_file`. Both
/// commands diverged only in event name and a small read-error nuance;
/// this helper standardizes on `unwrap_or_default()` so an empty payload
/// is emitted on read failure (matches the original `watch_claude_file`
/// behavior; the original `watch_file` skipped emit on read error).
fn watch_file_internal(
    app: AppHandle,
    path: String,
    event_name: &'static str,
    stop: Arc<AtomicBool>,
    watch_id: u32,
) {
    std::thread::spawn(move || {
        let mut last_modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        loop {
            std::thread::sleep(Duration::from_millis(500));
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let current = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
            if current != last_modified {
                last_modified = current;
                let size = std::fs::metadata(&path).map_or(0, |m| m.len());
                let content = if size <= MAX_WATCH_FILE_SIZE {
                    std::fs::read_to_string(&path).unwrap_or_default()
                } else {
                    String::new()
                };
                let _ = app.emit(
                    event_name,
                    FileChanged {
                        watch_id,
                        path: path.clone(),
                        content,
                    },
                );
            }
        }
    });
}

/// Watch a file for changes, emit events
#[tauri::command]
pub(crate) async fn watch_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<u32, String> {
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

    watch_file_internal(app, validated_str, "file-changed", stop_clone, watch_id);
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

/// Watch a Claude settings file for changes and emit `claude-file-changed`
/// events. Mirrors `watch_file` (polling thread + `AtomicBool` stop flag
/// stored in `AppState.watch_flags`) to keep a single watch-management
/// pathway. Returns a watch id to pass to `unwatch_claude_file`.
#[tauri::command]
pub(crate) async fn watch_claude_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<u32, String> {
    let validated = validate_claude_read(&path)?;
    let validated_str = validated.to_string_lossy().to_string();

    let watch_id = NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();

    state
        .watch_flags
        .lock()
        .map_err(|e| e.to_string())?
        .insert(watch_id, stop);

    watch_file_internal(
        app,
        validated_str,
        "claude-file-changed",
        stop_clone,
        watch_id,
    );
    Ok(watch_id)
}

/// Stop a Claude file watcher started by `watch_claude_file`.
#[tauri::command]
pub(crate) async fn unwatch_claude_file(
    state: tauri::State<'_, AppState>,
    watch_id: u32,
) -> Result<(), String> {
    let mut flags = state.watch_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.remove(&watch_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::AppState;
    use std::collections::HashMap;
    use std::sync::Mutex;

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
}
