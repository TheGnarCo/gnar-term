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

/// Detect the user's terminal font by reading existing terminal configs
#[tauri::command]
async fn detect_font() -> Result<String, String> {
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
            // Look for family = "..." under [font.normal]
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
            if line.contains("font_family") || line.contains("font =" ) {
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
                    .args(["read", "com.apple.Terminal", &format!("Window Settings")])
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
        // Preferred fonts in order — if any is installed, use it
        let preferred = [
            "MesloLGS Nerd Font Mono",  // powerlevel10k default
            "MesloLGS NF",              // older p10k installs
            "JetBrainsMono Nerd Font Mono",
            "Hack Nerd Font Mono",
            "FiraCode Nerd Font Mono",
            "JetBrains Mono",
            "SF Mono",
            "Menlo",
        ];

        // Run system_profiler once, check all preferred fonts
        if let Ok(output) = std::process::Command::new("system_profiler")
            .args(["SPFontsDataType"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for font_name in preferred {
                if text.contains(font_name) {
                    return Ok(font_name.to_string());
                }
            }
        }

        // Faster check via font file existence
        let font_dirs = [
            format!("{home}/Library/Fonts"),
            "/Library/Fonts".to_string(),
            "/System/Library/Fonts".to_string(),
        ];
        for font_name in preferred {
            let search_term = font_name.replace(' ', "").to_lowercase();
            for dir in &font_dirs {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_lowercase().replace(' ', "");
                        if name.contains(&search_term) || name.contains(&search_term.replace("nerdfontmono", "nfm")) {
                            return Ok(font_name.to_string());
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

        if let Ok(output) = std::process::Command::new("fc-list").args([":spacing=100", "family"]).output() {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty, write_pty, resize_pty, kill_pty, detect_font
        ])
        .setup(|app| {
            // Rebuild macOS menu manually so Cmd+Q, Cmd+C, Cmd+V work,
            // but Cmd+T/Cmd+W/Cmd+N are passed down to JS.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, Submenu, PredefinedMenuItem};
                let handle = app.handle();
                
                // GnarTerm Menu
                let hide = PredefinedMenuItem::hide(handle, None)?;
                let hide_others = PredefinedMenuItem::hide_others(handle, None)?;
                let show_all = PredefinedMenuItem::show_all(handle, None)?;
                let quit = PredefinedMenuItem::quit(handle, None)?;
                
                let app_menu = Submenu::with_items(
                    handle,
                    "GnarTerm",
                    true,
                    &[&hide, &hide_others, &show_all, &PredefinedMenuItem::separator(handle)?, &quit],
                )?;

                // Edit Menu (Copy/Paste/Select All)
                let copy = PredefinedMenuItem::copy(handle, None)?;
                let paste = PredefinedMenuItem::paste(handle, None)?;
                let select_all = PredefinedMenuItem::select_all(handle, None)?;
                
                let edit_menu = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[&copy, &paste, &select_all],
                )?;

                let menu = Menu::with_items(handle, &[&app_menu, &edit_menu])?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running GnarTerm");
}
