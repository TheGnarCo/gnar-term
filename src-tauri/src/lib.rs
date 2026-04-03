use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);
static NEXT_WATCH_ID: AtomicU32 = AtomicU32::new(1);

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    // master is kept alive to keep the PTY open
    _master: Box<dyn MasterPty + Send>,
    child_pid: Option<u32>,
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
struct PtyTitle {
    pty_id: u32,
    title: String,
}

#[derive(Clone, Serialize)]
struct PtyCwd {
    pty_id: u32,
    cwd: String,
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
    cwd: Option<String>,
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
    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    let child = pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let child_pid = child.process_id();

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
                child_pid,
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
        let mut prev_esc = false;

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
                                    // OSC 0 or OSC 2: set window title
                                    if s.starts_with("0;") || s.starts_with("2;") {
                                        let title = s.splitn(2, ';').nth(1).unwrap_or("").to_string();
                                        let _ = app_handle.emit(
                                            "pty-title",
                                            PtyTitle { pty_id: id, title },
                                        );
                                    }
                                    // OSC 7: set working directory
                                    if s.starts_with("7;") {
                                        let url = s.splitn(2, ';').nth(1).unwrap_or("").to_string();
                                        // OSC 7 sends file://hostname/path
                                        let cwd = if let Some(path) = url.strip_prefix("file://") {
                                            // Skip hostname part
                                            if let Some(slash_idx) = path[1..].find('/') {
                                                path[slash_idx + 1..].to_string()
                                            } else {
                                                path.to_string()
                                            }
                                        } else {
                                            url
                                        };
                                        let _ = app_handle.emit(
                                            "pty-cwd",
                                            PtyCwd { pty_id: id, cwd },
                                        );
                                    }
                                }
                                osc_buf.clear();
                                in_osc = false;
                            } else {
                                osc_buf.push(byte);
                            }
                        } else if byte == 0x1b {
                            prev_esc = true;
                        } else if byte == 0x5d && prev_esc {
                            // \x1b] — OSC start
                            in_osc = true;
                            osc_buf.clear();
                            prev_esc = false;
                        } else {
                            prev_esc = false;
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
    println!("[detect_font] Checking ghostty config: {}", ghostty_path);
    if let Ok(content) = std::fs::read_to_string(&ghostty_path) {
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with("font-family") {
                if let Some(val) = line.split('=').nth(1) {
                    let font = val.trim().to_string();
                    if !font.is_empty() {
                        println!("[detect_font] Found font in ghostty config: {}", font);
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
        println!("[detect_font] Checking alacritty config: {}", path);
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
                            println!("[detect_font] Found font in alacritty config: {}", font);
                            return Ok(font);
                        }
                    }
                }
            }
        }
    }

    // 3. Kitty config
    let kitty_path = format!("{home}/.config/kitty/kitty.conf");
    println!("[detect_font] Checking kitty config: {}", kitty_path);
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
                    println!("[detect_font] Found font in kitty config: {}", font);
                    return Ok(font);
                }
            }
        }
    }

    // 4. WezTerm config (Lua — best effort)
    let wez_path = format!("{home}/.wezterm.lua");
    println!("[detect_font] Checking wezterm config: {}", wez_path);
    if let Ok(content) = std::fs::read_to_string(&wez_path) {
        for line in content.lines() {
            if line.contains("font_family") || line.contains("font =" ) {
                // Extract quoted string
                if let Some(start) = line.find('"') {
                    if let Some(end) = line[start + 1..].find('"') {
                        let font = line[start + 1..start + 1 + end].to_string();
                        if !font.is_empty() {
                            println!("[detect_font] Found font in wezterm config: {}", font);
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
        println!("[detect_font] Checking iTerm2 config");
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
                                    println!("[detect_font] Found font in iTerm2 config: {}", font);
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
        println!("[detect_font] Checking Terminal.app config");
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
        println!("[detect_font] Checking filesystem for fonts");
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
                            println!("[detect_font] Found installed font via filesystem: {} (file: {})", css_name, file_name);
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
    println!("[detect_font] No preferred font found. Using default.");
    Ok(String::new())
}

/// Read a file's contents
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Watch a file for changes, emit events
#[tauri::command]
async fn watch_file(app: AppHandle, path: String) -> Result<u32, String> {
    let watch_id = NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
    let path_clone = path.clone();
    std::thread::spawn(move || {
        let mut last_modified = std::fs::metadata(&path_clone)
            .and_then(|m| m.modified())
            .ok();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
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

#[derive(Clone, Serialize)]
struct FileChanged {
    watch_id: u32,
    path: String,
    content: String,
}

/// Get the title for a PTY tab — foreground process name or cwd basename
#[tauri::command]
async fn get_pty_title(state: tauri::State<'_, AppState>, pty_id: u32) -> Result<String, String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = ptys.get(&pty_id) {
        if let Some(pid) = entry.child_pid {
            // macOS: get foreground process via ps
            #[cfg(target_os = "macos")]
            {
                // Try to get the foreground process group leader
                let output = std::process::Command::new("ps")
                    .args(["-o", "comm=", "-g", &pid.to_string()])
                    .output();
                if let Ok(out) = output {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let procs: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
                    // Last process is usually the foreground one
                    if let Some(last) = procs.last() {
                        let name = last.rsplit('/').next().unwrap_or(last).trim();
                        // If it's not the shell itself, return process name
                        if !name.is_empty() && name != "zsh" && name != "bash" && name != "fish" && name != "sh" {
                            return Ok(name.to_string());
                        }
                    }
                }
                // Fall back to cwd basename
                let output = std::process::Command::new("lsof")
                    .args(["-p", &pid.to_string(), "-Fn", "-d", "cwd"])
                    .output();
                if let Ok(out) = output {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    for line in stdout.lines() {
                        if let Some(path) = line.strip_prefix('n') {
                            if path.starts_with('/') {
                                let base = path.rsplit('/').next().unwrap_or(path);
                                if base == std::env::var("USER").unwrap_or_default() {
                                    return Ok("~".to_string());
                                }
                                return Ok(base.to_string());
                            }
                        }
                    }
                }
            }
            // Linux: read /proc foreground process
            #[cfg(target_os = "linux")]
            {
                if let Ok(path) = std::fs::read_link(format!("/proc/{}/cwd", pid)) {
                    let base = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    return Ok(base);
                }
            }
        }
    }
    Ok(String::new())
}

/// Get the working directory of a PTY's child process
#[tauri::command]
async fn get_pty_cwd(state: tauri::State<'_, AppState>, pty_id: u32) -> Result<String, String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = ptys.get(&pty_id) {
        if let Some(pid) = entry.child_pid {
            // macOS: use lsof to get cwd
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("lsof")
                    .args(["-p", &pid.to_string(), "-Fn", "-d", "cwd"])
                    .output()
                    .map_err(|e| format!("lsof failed: {e}"))?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Some(path) = line.strip_prefix('n') {
                        if path.starts_with('/') {
                            return Ok(path.to_string());
                        }
                    }
                }
            }
            // Linux: read /proc/<pid>/cwd
            #[cfg(target_os = "linux")]
            {
                if let Ok(path) = std::fs::read_link(format!("/proc/{}/cwd", pid)) {
                    return Ok(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(String::new())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty, write_pty, resize_pty, kill_pty, detect_font, get_pty_cwd, get_pty_title, read_file, watch_file
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
