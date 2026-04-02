use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    // master is kept alive to keep the PTY open
    _master: Box<dyn MasterPty + Send>,
}

struct AppState {
    ptys: Mutex<HashMap<u32, PtyInstance>>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    pty_id: u32,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
struct PtyNotification {
    pty_id: u32,
    text: String,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    pty_id: u32,
}

/// Spawn a new PTY with a shell
#[tauri::command]
async fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);

    // Spawn shell
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

    // Get writer for input
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {e}"))?;

    // Get reader for output
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {e}"))?;

    // Store PTY
    {
        let mut ptys = state.ptys.lock().unwrap();
        ptys.insert(
            pty_id,
            PtyInstance {
                writer,
                _master: pair.master,
            },
        );
    }

    // Spawn reader thread — forwards PTY output to frontend
    let app_handle = app.clone();
    let id = pty_id;
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // Simple OSC notification parser state
        let mut osc_buf = Vec::new();
        let mut in_osc = false;

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // PTY closed — notify frontend
                    let _ = app_handle.emit("pty-exit", PtyExit { pty_id: id });
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];

                    // Scan for OSC sequences (notifications)
                    for &byte in data {
                        if in_osc {
                            if byte == 0x07 || byte == 0x9c {
                                // End of OSC — check if it's a notification
                                if let Ok(s) = String::from_utf8(osc_buf.clone()) {
                                    // OSC 9 (iterm2), OSC 99 (kitty), OSC 777 (rxvt)
                                    let is_notify = s.starts_with("9;")
                                        || s.starts_with("99;")
                                        || s.starts_with("777;");
                                    if is_notify {
                                        let text = s.splitn(2, ';').nth(1).unwrap_or("").to_string();
                                        let _ = app_handle.emit(
                                            "pty-notification",
                                            PtyNotification {
                                                pty_id: id,
                                                text,
                                            },
                                        );
                                    }
                                }
                                osc_buf.clear();
                                in_osc = false;
                            } else {
                                osc_buf.push(byte);
                            }
                        } else if byte == 0x1b {
                            // Could be start of OSC (\x1b])
                            // We'll check next byte
                        } else if byte == 0x5d && !osc_buf.is_empty() {
                            // \x1b] — OSC start (previous byte was ESC)
                            in_osc = true;
                            osc_buf.clear();
                        }
                    }

                    let _ = app_handle.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: id,
                            data: data.to_vec(),
                        },
                    );
                }
                Err(_) => {
                    let _ = app_handle.emit("pty-exit", PtyExit { pty_id: id });
                    break;
                }
            }
        }
    });

    Ok(pty_id)
}

/// Write data to a PTY
#[tauri::command]
async fn write_pty(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
    data: String,
) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let pty = ptys
        .get_mut(&pty_id)
        .ok_or_else(|| format!("PTY {pty_id} not found"))?;
    pty.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

/// Resize a PTY
#[tauri::command]
async fn resize_pty(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let pty = ptys
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {pty_id} not found"))?;
    pty._master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {e}"))?;
    Ok(())
}

/// Kill a PTY
#[tauri::command]
async fn kill_pty(state: tauri::State<'_, AppState>, pty_id: u32) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    ptys.remove(&pty_id);
    Ok(())
}

/// Detect installed monospace/nerd fonts
#[tauri::command]
async fn detect_fonts() -> Result<Vec<String>, String> {
    let output = std::process::Command::new("fc-list")
        .args([":spacing=100", "family"])
        .output();

    // fc-list is Linux; on macOS try system_profiler or atsutil
    let result = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => {
            // macOS fallback
            let mac_output = std::process::Command::new("system_profiler")
                .args(["SPFontsDataType"])
                .output();
            match mac_output {
                Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
                Err(_) => return Ok(vec![]),
            }
        }
    };

    // Parse for nerd font / mono font names
    let nerd_fonts: Vec<String> = result
        .lines()
        .filter(|l| {
            let lower = l.to_lowercase();
            lower.contains("nerd") || lower.contains("powerline") || lower.contains("mono")
        })
        .map(|l| l.trim().trim_end_matches(',').to_string())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    Ok(nerd_fonts)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty, write_pty, resize_pty, kill_pty, detect_fonts
        ])
        .run(tauri::generate_context!())
        .expect("error while running GnarTerm");
}
