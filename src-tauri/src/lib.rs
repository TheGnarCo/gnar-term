use clap::Parser;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

pub mod mcp_bridge;
pub mod mcp_register;

/// CLI arguments for `GnarTerm`.
#[derive(Parser, Debug, Clone, Default, Serialize)]
#[command(name = "gnar-term", version, about = "Terminal workspace manager")]
pub struct CliArgs {
    /// Directory to open in
    #[arg(value_name = "PATH", conflicts_with = "working_directory")]
    pub path: Option<String>,

    /// Directory to open in (explicit flag)
    #[arg(short = 'd', long = "working-directory")]
    pub working_directory: Option<String>,

    /// Command to execute in the terminal
    #[arg(short = 'e', long = "command")]
    pub command: Option<String>,

    /// Window/workspace title
    #[arg(long)]
    pub title: Option<String>,

    /// Load a named workspace from config
    #[arg(short = 'w', long)]
    pub workspace: Option<String>,

    /// Path to config file
    #[arg(short = 'c', long)]
    pub config: Option<String>,
}

/// Flags accepted by `CliArgs` that take a value argument.
const VALUE_FLAGS: &[&str] = &[
    "-d",
    "--working-directory",
    "-e",
    "--command",
    "--title",
    "-w",
    "--workspace",
    "-c",
    "--config",
];

/// Flags accepted by `CliArgs` that are standalone (no value).
const STANDALONE_FLAGS: &[&str] = &["-h", "--help", "-V", "--version"];

/// Filter argv to only args defined by `CliArgs`, dropping unknown flags
/// that leak from Cargo/Tauri during `tauri dev` (e.g. --color, --no-default-features).
fn filter_known_args(args: impl Iterator<Item = String>) -> Vec<String> {
    let mut result = Vec::new();
    let mut args = args.peekable();

    // Always keep the binary name.
    if let Some(bin) = args.next() {
        result.push(bin);
    }

    while let Some(arg) = args.next() {
        if !arg.starts_with('-') || arg == "-" {
            // Positional arg — keep it.
            result.push(arg);
        } else if arg == "--" {
            // End-of-flags marker — keep it and everything after.
            result.push(arg);
            result.extend(args);
            break;
        } else if arg.contains('=') {
            // --flag=value form: keep only if the flag part is known.
            let flag = arg.split('=').next().unwrap_or("");
            if VALUE_FLAGS.contains(&flag) {
                result.push(arg);
            }
        } else if VALUE_FLAGS.contains(&arg.as_str()) {
            // Known flag with a separate value — keep both.
            result.push(arg);
            if let Some(val) = args.next() {
                result.push(val);
            }
        } else if STANDALONE_FLAGS.contains(&arg.as_str()) {
            result.push(arg);
        } else if arg.starts_with("-psn_") {
            // macOS Finder process serial number — drop.
        } else {
            // Unknown flag — drop it, and also drop its value if the next
            // arg looks like a flag-value (not starting with '-' or '/~.').
            if let Some(next) = args.peek() {
                if !next.starts_with('-')
                    && !next.starts_with('/')
                    && !next.starts_with('~')
                    && !next.starts_with('.')
                {
                    args.next(); // consume the value too
                }
            }
        }
    }

    result
}

fn expand_path(path: &str) -> String {
    let expanded = if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/{rest}")
    } else {
        path.to_string()
    };
    std::fs::canonicalize(&expanded)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(expanded)
}

fn resolve_cli_paths(mut args: CliArgs) -> CliArgs {
    if let Some(ref p) = args.path {
        args.path = Some(expand_path(p));
    }
    if let Some(ref p) = args.working_directory {
        args.working_directory = Some(expand_path(p));
    }
    if let Some(ref p) = args.config {
        args.config = Some(expand_path(p));
    }
    args
}

static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);
static NEXT_WATCH_ID: AtomicU32 = AtomicU32::new(1);

/// Classification of a parsed OSC sequence.
#[derive(Debug, PartialEq)]
enum OscAction {
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
fn classify_osc(raw: &str) -> OscAction {
    // OSC 0 or OSC 2: set window title  (e.g. "0;my title")
    if raw.starts_with("0;") || raw.starts_with("2;") {
        let title = raw.split_once(';').map_or("", |x| x.1).to_string();
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

    // Filter out color-query responses like "rgb:ffff/ffff/ffff" or "rgba:..."
    if text.starts_with("rgb:") || text.starts_with("rgba:") {
        return OscAction::Ignore;
    }

    OscAction::Notification(text.to_string())
}

/// Shared pause state — uses a Condvar so the reader thread blocks efficiently
/// instead of spin-waiting when the frontend signals backpressure.
struct PauseFlag {
    mu: std::sync::Mutex<bool>,
    cv: std::sync::Condvar,
}

impl PauseFlag {
    fn new() -> Self {
        Self {
            mu: std::sync::Mutex::new(false),
            cv: std::sync::Condvar::new(),
        }
    }
    fn pause(&self) {
        *self
            .mu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
    }
    fn resume(&self) {
        *self
            .mu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = false;
        self.cv.notify_one();
    }
    fn wait_if_paused(&self) {
        let guard = self
            .mu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // Block until paused == false (no CPU burn)
        let _guard = self
            .cv
            .wait_while(guard, |paused| *paused)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
}

struct PtyInstance {
    writer: Box<dyn Write + Send>,
    // master is kept alive to keep the PTY open
    master_pty: Box<dyn MasterPty + Send>,
    child_pid: Option<u32>,
    paused: std::sync::Arc<PauseFlag>,
}

struct AppState {
    ptys: Mutex<HashMap<u32, PtyInstance>>,
    watch_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
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
struct PtyExit {
    pty_id: u32,
}

/// Return CLI arguments passed to the app.
#[tauri::command]
fn get_cli_args(args: tauri::State<'_, CliArgs>) -> CliArgs {
    args.inner().clone()
}

/// Spawn a new PTY with a shell.
///
/// `on_output` is a Tauri v2 IPC Channel that carries raw PTY bytes to the
/// webview. Using a per-pty Channel with `InvokeResponseBody::Raw` delivers
/// bytes via the ipc custom-protocol path (`ArrayBuffer` in JS) instead of one
/// `evaluateJavaScript` call per chunk, so bursty output no longer pegs the
/// `WebContent` main thread on macOS.
///
/// `extra_env` is an optional map of additional env vars merged into the
/// child's environment after the shell-integration vars are set. Used to
/// inject `GNAR_TERM_PANE_ID` and `GNAR_TERM_WORKSPACE_ID` so MCP agents
/// running inside a pane can advertise their host context to the GUI.
#[tauri::command]
async fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_output: Channel<InvokeResponseBody>,
    extra_env: Option<HashMap<String, String>>,
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
    // Report as ghostty so CLI apps (e.g. Claude Code) enable the kitty
    // keyboard protocol. Claude Code gates this on a hardcoded TERM_PROGRAM
    // allowlist with no capability negotiation fallback.
    cmd.env("TERM_PROGRAM", "ghostty");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    // Inject OSC 7 cwd reporting for shells that don't do it automatically
    // This makes zsh/bash report the working directory on every prompt
    // Shell integration: inject OSC 7 cwd reporting (cross-platform)
    let home = std::env::var("HOME").unwrap_or_default();
    let integration_dir = format!("{home}/.config/gnar-term/shell");
    let _ = std::fs::create_dir_all(&integration_dir);

    // zsh: ZDOTDIR override
    let zshenv = r#"# GnarTerm shell integration
[ -f "$GNARTERM_ORIG_ZDOTDIR/.zshenv" ] && source "$GNARTERM_ORIG_ZDOTDIR/.zshenv"
export ZDOTDIR="$GNARTERM_ORIG_ZDOTDIR"
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
precmd_functions+=(_gnarterm_report_cwd)
chpwd_functions+=(_gnarterm_report_cwd)
"#;
    let _ = std::fs::write(format!("{integration_dir}/.zshenv"), zshenv);
    let orig_zdotdir = std::env::var("ZDOTDIR").unwrap_or(home.clone());
    cmd.env("GNARTERM_ORIG_ZDOTDIR", &orig_zdotdir);
    cmd.env("ZDOTDIR", &integration_dir);

    // bash/fish: use GNARTERM_SHELL_INTEGRATION env var
    // Bash users can add to .bashrc: [ -n "$GNARTERM_SHELL_INTEGRATION" ] && source "$GNARTERM_SHELL_INTEGRATION"
    let bash_integration = format!("{home}/.config/gnar-term/shell/bash-integration.sh");
    let bash_content = r#"# GnarTerm bash integration
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
PROMPT_COMMAND="_gnarterm_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
"#;
    let _ = std::fs::write(&bash_integration, bash_content);
    cmd.env("GNARTERM_SHELL_INTEGRATION", &bash_integration);

    // Pass through EDITOR/VISUAL so git commit, crontab, etc. open the right editor
    if let Ok(editor) = std::env::var("EDITOR") {
        cmd.env("EDITOR", &editor);
    }
    if let Ok(visual) = std::env::var("VISUAL") {
        cmd.env("VISUAL", &visual);
    }

    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    // Merge caller-provided env vars last so they win over our shell-integration
    // defaults (e.g. allow MCP context vars or test harnesses to override).
    if let Some(extra) = extra_env {
        for (k, v) in extra {
            cmd.env(&k, &v);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let child_pid = child.process_id();

    // Drop the slave fd in the parent — the child now owns it exclusively.
    // Without this, interactive programs (vim, nano, etc.) spawned by the child
    // shell cannot properly take control of the terminal.
    drop(pair.slave);

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

    let paused = std::sync::Arc::new(PauseFlag::new());
    let paused_clone = paused.clone();

    // Store PTY
    {
        let mut ptys = state.ptys.lock().map_err(|e| e.to_string())?;
        ptys.insert(
            pty_id,
            PtyInstance {
                writer,
                master_pty: pair.master,
                child_pid,
                paused: paused_clone,
            },
        );
    }

    // Spawn reader thread — forwards PTY output to frontend
    let app_handle = app.clone();
    let id = pty_id;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let paused_flag = paused.clone();
        // Simple OSC notification parser state
        let mut osc_buf = Vec::new();
        let mut in_osc = false;
        let mut prev_esc = false;

        loop {
            // Flow control: block until frontend signals it can accept more data.
            // Uses a condvar — no CPU burn while waiting.
            paused_flag.wait_if_paused();
            match reader.read(&mut buf) {
                Ok(0) => {
                    // PTY closed — notify frontend
                    let _ = app_handle.emit("pty-exit", PtyExit { pty_id: id });
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];

                    // Helper: classify and dispatch a completed OSC sequence
                    let dispatch_osc = |buf: &[u8]| {
                        if let Ok(s) = String::from_utf8(buf.to_vec()) {
                            match classify_osc(&s) {
                                OscAction::Notification(text) => {
                                    let _ = app_handle.emit(
                                        "pty-notification",
                                        PtyNotification { pty_id: id, text },
                                    );
                                }
                                OscAction::Title(title) => {
                                    let _ = app_handle
                                        .emit("pty-title", PtyTitle { pty_id: id, title });
                                }
                                OscAction::Ignore => {}
                            }
                        }
                    };

                    // Scan for OSC sequences (notifications/titles)
                    for &byte in data {
                        if in_osc {
                            if byte == 0x07 || byte == 0x9c {
                                // BEL or single-byte ST — end of OSC
                                dispatch_osc(&osc_buf);
                                osc_buf.clear();
                                in_osc = false;
                                prev_esc = false;
                            } else if byte == 0x1b {
                                // Could be ESC \ (two-byte ST) — set flag
                                prev_esc = true;
                            } else if byte == 0x5c && prev_esc {
                                // ESC \ — two-byte String Terminator, end of OSC
                                dispatch_osc(&osc_buf);
                                osc_buf.clear();
                                in_osc = false;
                                prev_esc = false;
                            } else if prev_esc {
                                // ESC followed by something other than \ or ] —
                                // the OSC was malformed; abort and start fresh
                                osc_buf.clear();
                                in_osc = false;
                                // Check if this ESC starts a new OSC
                                if byte == 0x5d {
                                    in_osc = true;
                                }
                                prev_esc = false;
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

                    if on_output
                        .send(InvokeResponseBody::Raw(data.to_vec()))
                        .is_err()
                    {
                        break;
                    }
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
    let mut ptys = state.ptys.lock().map_err(|e| e.to_string())?;
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
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    let pty = ptys
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {pty_id} not found"))?;
    pty.master_pty
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
    let mut ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.remove(&pty_id) {
        // Ensure the reader thread isn't blocked on the condvar
        pty.paused.resume();

        if let Some(pid) = pty.child_pid {
            #[cfg(unix)]
            {
                let pid_i32 =
                    i32::try_from(pid).map_err(|_| format!("PID {pid} exceeds i32::MAX"))?;
                unsafe {
                    libc::kill(-pid_i32, libc::SIGKILL);
                }
                unsafe {
                    libc::kill(pid_i32, libc::SIGKILL);
                }
            }
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .output();
            }
        }
        // Dropping pty closes the master fd which sends SIGHUP
    }
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

/// Pause PTY reader (flow control — frontend buffer is full)
#[tauri::command]
async fn pause_pty(state: tauri::State<'_, AppState>, pty_id: u32) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.get(&pty_id) {
        pty.paused.pause();
    }
    Ok(())
}

/// Resume PTY reader (flow control — frontend buffer drained)
#[tauri::command]
async fn resume_pty(state: tauri::State<'_, AppState>, pty_id: u32) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.get(&pty_id) {
        pty.paused.resume();
    }
    Ok(())
}

/// Block reads to sensitive directories (SSH keys, credentials, etc.)
fn validate_read_path(path: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Invalid path {path}: {e}"))?;
    let path_str = canonical.to_string_lossy();

    if let Ok(home) = std::env::var("HOME") {
        let blocked = [
            "/.ssh",
            "/.gnupg",
            "/.aws",
            "/.kube",
            "/.config/gcloud",
            "/.docker",
        ];
        for prefix in blocked {
            if path_str.starts_with(&format!("{home}{prefix}")) {
                return Err(format!("Access denied: {path}"));
            }
        }
    }
    if path_str.starts_with("/etc/shadow") || path_str.starts_with("/etc/gshadow") {
        return Err(format!("Access denied: {path}"));
    }
    Ok(canonical)
}

/// Check if a file exists (lightweight — no read)
#[tauri::command]
async fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// List filenames in a directory (non-recursive, files only)
#[tauri::command]
async fn list_dir(path: String) -> Result<Vec<String>, String> {
    let entries =
        std::fs::read_dir(&path).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
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

/// Read a file's contents
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    std::fs::read_to_string(&validated).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Directory entry metadata for the MCP `list_dir` tool.
#[derive(Clone, Serialize)]
struct McpDirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

/// List a directory as a vector of entries with type + size metadata.
/// Unlike `list_dir` (which returns only file names) this returns directories
/// and files so the CWD File Navigator can render a tree.
#[tauri::command]
async fn mcp_list_dir(
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
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let entry_path = entry.path().to_string_lossy().to_string();
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

/// Return `(exists, is_dir)` for the MCP `file_exists` tool.
#[tauri::command]
async fn mcp_file_info(path: String) -> (bool, bool) {
    match std::fs::metadata(&path) {
        Ok(m) => (true, m.is_dir()),
        Err(_) => (false, false),
    }
}

/// Read a file as base64 (for binary files like images)
#[tauri::command]
async fn read_file_base64(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    let bytes = std::fs::read(&validated).map_err(|e| format!("Failed to read {path}: {e}"))?;
    Ok(b64_encode(&bytes))
}

fn b64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = if chunk.len() > 1 {
            u32::from(chunk[1])
        } else {
            0
        };
        let b2 = if chunk.len() > 2 {
            u32::from(chunk[2])
        } else {
            0
        };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Validate that a write path is under ~/.config/gnar-term/
fn validate_write_path(path: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let allowed = format!("{home}/.config/gnar-term");

    // Manually resolve .. components to prevent traversal attacks on paths
    // that may not exist yet (canonicalize requires the path to exist).
    let mut resolved = Vec::new();
    for component in std::path::Path::new(path).components() {
        match component {
            std::path::Component::ParentDir => {
                resolved.pop();
            }
            std::path::Component::CurDir => {}
            c => resolved.push(c),
        }
    }
    let norm_path: std::path::PathBuf = resolved.into_iter().collect();
    let norm_allowed = std::path::Path::new(&allowed)
        .components()
        .collect::<std::path::PathBuf>();

    if !norm_path.starts_with(&norm_allowed) {
        return Err(format!("Write denied: path must be under {allowed}"));
    }
    Ok(())
}

/// Write content to a file
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Ensure a directory exists
#[tauri::command]
async fn ensure_dir(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {path}: {e}"))
}

/// Get the user's home directory
#[tauri::command]
async fn get_home() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "HOME not set".to_string())
}

/// Show a file in the system file manager
#[tauri::command]
async fn show_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        let canonical = std::fs::canonicalize(&path).map_err(|e| format!("Invalid path: {}", e))?;
        std::process::Command::new("explorer")
            .args(["/select,", &canonical.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a file with the default system app
#[tauri::command]
async fn open_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Watch a file for changes, emit events
#[tauri::command]
async fn watch_file(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<u32, String> {
    let watch_id = NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = stop.clone();

    state
        .watch_flags
        .lock()
        .map_err(|e| e.to_string())?
        .insert(watch_id, stop);

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
                    let _ = app.emit(
                        "file-changed",
                        FileChanged {
                            watch_id,
                            path: path_clone.clone(),
                            content,
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
async fn unwatch_file(state: tauri::State<'_, AppState>, watch_id: u32) -> Result<(), String> {
    let mut flags = state.watch_flags.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = flags.remove(&watch_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct FileChanged {
    watch_id: u32,
    path: String,
    content: String,
}

/// Get the child process PID for a PTY, if known.
#[tauri::command]
async fn get_pty_pid(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<Option<u32>, String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    Ok(ptys.get(&pty_id).and_then(|p| p.child_pid))
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
                        if !name.is_empty()
                            && name != "zsh"
                            && name != "bash"
                            && name != "fish"
                            && name != "sh"
                        {
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
                    let base = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
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
                    .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
                    .output()
                    .map_err(|e| format!("lsof failed: {e}"))?;
                let stdout = String::from_utf8_lossy(&output.stdout);
                // lsof -Fn output: "pPID\nfcwd\nn/path\n"
                // With -a (AND), -p PID, -d cwd: only returns cwd for that PID
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

/// Find a file by name using platform-specific search
#[tauri::command]
async fn find_file(name: String) -> Result<String, String> {
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
    Err(format!("File not found: {name}"))
}

/// Read the `mcp` setting from `gnar-term.json`. Returns `"auto"` if no
/// config exists or the field is missing. Values that aren't recognized fall
/// back to `"auto"`.
fn read_mcp_setting() -> String {
    let paths: Vec<std::path::PathBuf> = {
        let mut v = Vec::new();
        v.push(std::path::PathBuf::from("gnar-term.json"));
        v.push(std::path::PathBuf::from("cmux.json"));
        if let Ok(home) = std::env::var("HOME") {
            v.push(std::path::PathBuf::from(format!(
                "{home}/.config/gnar-term/gnar-term.json"
            )));
        }
        v
    };
    for p in paths {
        if let Ok(s) = std::fs::read_to_string(&p) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                if let Some(mcp) = v.get("mcp").and_then(|m| m.as_str()) {
                    match mcp {
                        "on" | "off" | "auto" => return mcp.to_string(),
                        _ => return "auto".to_string(),
                    }
                }
            }
        }
    }
    "auto".to_string()
}

/// Decide whether the MCP bridge should bind on this launch based on the user
/// setting and Claude Code detection.
fn mcp_should_start() -> bool {
    match read_mcp_setting().as_str() {
        "off" => false,
        "on" => true,
        _ => mcp_register::detect_claude_code(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Handle --mcp-stdio BEFORE touching Tauri — this mode is a pure byte
    // pipe and never launches the GUI.
    let raw_args: Vec<String> = std::env::args().collect();
    if raw_args.iter().any(|a| a == "--mcp-stdio") {
        std::process::exit(mcp_bridge::run_stdio_shim());
    }

    // Parse CLI args. Use whitelist filter to drop unknown flags that leak
    // from Cargo/Tauri during `tauri dev` (--color, --no-default-features, etc.).
    let filtered_args = filter_known_args(std::env::args());
    let cli_args = resolve_cli_paths(CliArgs::parse_from(filtered_args));

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        })
        .manage(cli_args)
        .invoke_handler(tauri::generate_handler![
            get_cli_args,
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
            pause_pty,
            resume_pty,
            detect_font,
            get_pty_cwd,
            get_pty_pid,
            get_pty_title,
            file_exists,
            list_dir,
            read_file,
            read_file_base64,
            write_file,
            ensure_dir,
            get_home,
            watch_file,
            unwatch_file,
            show_in_file_manager,
            open_with_default_app,
            find_file,
            mcp_list_dir,
            mcp_file_info
        ])
        .setup(|app| {
            // Set window title from CLI --title flag
            {
                use tauri::Manager;
                let cli = app.state::<CliArgs>();
                if let Some(ref title) = cli.title {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_title(title);
                    }
                }
            }

            // MCP bridge — opt-in, dormant unless enabled by setting + Claude
            // Code detection.
            if mcp_should_start() {
                let bridge_state = mcp_bridge::BridgeState::new();
                if let Err(_e) = mcp_bridge::spawn(app.handle().clone(), bridge_state) {
                    // Bridge failure is non-fatal; the module logs its own
                    // error. We intentionally swallow it so the GUI stays up.
                } else if let Ok(exe) = std::env::current_exe() {
                    let exe_str = exe.to_string_lossy().to_string();
                    std::thread::spawn(move || {
                        mcp_register::register_if_needed(&exe_str);
                    });
                }
            }

            // Rebuild macOS menu manually so Cmd+Q, Cmd+C, Cmd+V work,
            // but Cmd+T/Cmd+W/Cmd+N are passed down to JS.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
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
                    &[
                        &hide,
                        &hide_others,
                        &show_all,
                        &PredefinedMenuItem::separator(handle)?,
                        &quit,
                    ],
                )?;

                // Edit Menu — Copy/Cut/Paste/Select All are PredefinedMenuItems
                // which enable native clipboard in the WebView for non-terminal
                // content (preview surfaces, command palette, etc.).
                // Terminal surfaces override Cmd+C/V via attachCustomKeyEventHandler.
                let cut = PredefinedMenuItem::cut(handle, None)?;
                let copy = PredefinedMenuItem::copy(handle, None)?;
                let paste = PredefinedMenuItem::paste(handle, None)?;
                let select_all = PredefinedMenuItem::select_all(handle, None)?;

                let edit_menu =
                    Submenu::with_items(handle, "Edit", true, &[&cut, &copy, &paste, &select_all])?;

                let cmd_palette = MenuItem::with_id(
                    handle,
                    "cmd-palette",
                    "Command Palette...",
                    true,
                    Some("CmdOrCtrl+P"),
                )?;
                let close_tab =
                    MenuItem::with_id(handle, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;

                // View > Theme submenu
                use tauri::menu::MenuItem;
                let theme_github = MenuItem::with_id(
                    handle,
                    "theme-github-dark",
                    "GitHub Dark",
                    true,
                    None::<&str>,
                )?;
                let theme_tokyo = MenuItem::with_id(
                    handle,
                    "theme-tokyo-night",
                    "Tokyo Night",
                    true,
                    None::<&str>,
                )?;
                let theme_catppuccin = MenuItem::with_id(
                    handle,
                    "theme-catppuccin-mocha",
                    "Catppuccin Mocha",
                    true,
                    None::<&str>,
                )?;
                let theme_dracula =
                    MenuItem::with_id(handle, "theme-dracula", "Dracula", true, None::<&str>)?;
                let theme_solarized = MenuItem::with_id(
                    handle,
                    "theme-solarized-dark",
                    "Solarized Dark",
                    true,
                    None::<&str>,
                )?;
                let theme_onedark =
                    MenuItem::with_id(handle, "theme-one-dark", "One Dark", true, None::<&str>)?;

                let theme_sep = PredefinedMenuItem::separator(handle)?;
                let theme_molly =
                    MenuItem::with_id(handle, "theme-molly", "Molly", true, None::<&str>)?;
                let theme_molly_disco = MenuItem::with_id(
                    handle,
                    "theme-molly-disco",
                    "Molly Disco",
                    true,
                    None::<&str>,
                )?;
                let theme_github_light = MenuItem::with_id(
                    handle,
                    "theme-github-light",
                    "GitHub Light",
                    true,
                    None::<&str>,
                )?;
                let theme_solarized_light = MenuItem::with_id(
                    handle,
                    "theme-solarized-light",
                    "Solarized Light",
                    true,
                    None::<&str>,
                )?;
                let theme_catppuccin_latte = MenuItem::with_id(
                    handle,
                    "theme-catppuccin-latte",
                    "Catppuccin Latte",
                    true,
                    None::<&str>,
                )?;

                let theme_submenu = Submenu::with_items(
                    handle,
                    "Theme",
                    true,
                    &[
                        &theme_github,
                        &theme_tokyo,
                        &theme_catppuccin,
                        &theme_dracula,
                        &theme_solarized,
                        &theme_onedark,
                        &theme_sep,
                        &theme_molly,
                        &theme_molly_disco,
                        &theme_github_light,
                        &theme_solarized_light,
                        &theme_catppuccin_latte,
                    ],
                )?;

                let view_menu = Submenu::with_items(
                    handle,
                    "View",
                    true,
                    &[
                        &cmd_palette,
                        &close_tab,
                        &PredefinedMenuItem::separator(handle)?,
                        &theme_submenu,
                    ],
                )?;

                let menu = Menu::with_items(handle, &[&app_menu, &edit_menu, &view_menu])?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id.starts_with("theme-") {
                let _ = app.emit("menu-theme", id.to_string());
            } else if id == "cmd-palette" {
                let _ = app.emit("menu-cmd-palette", ());
            } else if id == "close-tab" {
                let _ = app.emit("menu-close-tab", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GnarTerm");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[test]
    fn pause_flag_blocks_and_resumes() {
        let flag = Arc::new(PauseFlag::new());
        let flag2 = flag.clone();

        flag.pause();

        // Spawn a thread that will wait on the flag
        let handle = std::thread::spawn(move || {
            let start = Instant::now();
            flag2.wait_if_paused();
            start.elapsed()
        });

        // Give the thread time to block
        std::thread::sleep(Duration::from_millis(50));

        // Resume — the thread should unblock
        flag.resume();

        let elapsed = handle.join().unwrap();
        assert!(
            elapsed >= Duration::from_millis(40),
            "Thread should have blocked ~50ms, got {elapsed:?}"
        );
        assert!(
            elapsed < Duration::from_millis(500),
            "Thread should resume quickly, got {elapsed:?}"
        );
    }

    #[test]
    fn pause_flag_does_not_block_when_not_paused() {
        let flag = PauseFlag::new();
        let start = Instant::now();
        flag.wait_if_paused();
        assert!(
            start.elapsed() < Duration::from_millis(5),
            "Should not block"
        );
    }

    /// Integration test: spawn a real PTY, run `ps aux`, read all output.
    /// Verifies that the reader loop + `PauseFlag` + 4KB buffer works without
    /// hanging. This is the exact scenario that caused the freeze.
    #[test]
    fn pty_read_ps_aux_does_not_hang() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("ps aux; echo '__DONE__'");

        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("Failed to get reader");
        let pause_flag = Arc::new(PauseFlag::new());
        let pause_clone = pause_flag.clone();

        // Read in a separate thread (mirrors the real reader thread)
        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096]; // Same buffer size as production
            let mut total_bytes = 0usize;
            let mut output = Vec::new();

            loop {
                pause_clone.wait_if_paused();
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        total_bytes += n;
                        output.extend_from_slice(&buf[..n]);

                        // Simulate backpressure: pause every 32KB, resume after 1ms
                        // This exercises the pause/resume cycle under load
                        if total_bytes % 32768 < 4096 {
                            pause_clone.wait_if_paused(); // would block if paused
                        }
                    }
                    Err(_) => break,
                }
            }
            (total_bytes, output)
        });

        // Simulate frontend backpressure: pause briefly, then resume
        // This tests that the reader thread doesn't deadlock when paused
        std::thread::sleep(Duration::from_millis(10));
        pause_flag.pause();
        std::thread::sleep(Duration::from_millis(50));
        pause_flag.resume();

        // Wait for reader to finish with a generous timeout
        let result = reader_handle.join().expect("Reader thread panicked");
        let (total_bytes, output) = result;

        // Verify we got real output
        assert!(total_bytes > 0, "Should have read some bytes from ps aux");
        let output_str = String::from_utf8_lossy(&output);
        assert!(
            output_str.contains("__DONE__"),
            "Should have received all output (got {total_bytes} bytes)"
        );
        println!("[test] ps aux produced {total_bytes} bytes — read successfully without hanging");
    }

    /// Stress test: spawn a PTY that dumps 1MB of output as fast as possible.
    /// Must complete within 10 seconds. With the old 64KB buffer + no flow
    /// control, xterm.js would freeze; this test verifies the Rust side can
    /// handle it without the reader thread stalling.
    #[test]
    fn pty_high_throughput_does_not_stall() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        // Generate ~500KB of output using yes (piped through head for determinism)
        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("yes 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' | head -c 500000; echo '__HIGH_THROUGHPUT_DONE__'");

        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("Failed to get reader");
        let pause_flag = Arc::new(PauseFlag::new());
        let pause_clone = pause_flag.clone();

        let start = Instant::now();

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut total = 0usize;
            let mut output_tail = Vec::new();

            loop {
                pause_clone.wait_if_paused();
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        total += n;
                        // Keep only last 4KB to check for done marker
                        output_tail.extend_from_slice(&buf[..n]);
                        if output_tail.len() > 8192 {
                            let start = output_tail.len() - 8192;
                            output_tail = output_tail[start..].to_vec();
                        }
                    }
                    Err(_) => break,
                }
            }
            (total, output_tail)
        });

        // Simulate aggressive backpressure: pause/resume rapidly
        for _ in 0..10 {
            std::thread::sleep(Duration::from_millis(5));
            pause_flag.pause();
            std::thread::sleep(Duration::from_millis(10));
            pause_flag.resume();
        }

        let (total, tail) = reader_handle.join().expect("Reader thread panicked");
        let elapsed = start.elapsed();

        assert!(
            elapsed < Duration::from_secs(10),
            "Should complete within 10s, took {elapsed:?}"
        );
        assert!(total > 50_000, "Should read at least 50KB, got {total}");
        let tail_str = String::from_utf8_lossy(&tail);
        assert!(
            tail_str.contains("__HIGH_THROUGHPUT_DONE__"),
            "Should receive completion marker (got {total} bytes total)"
        );
        println!("[test] High-throughput test: {total} bytes in {elapsed:?}");
    }

    // -----------------------------------------------------------------------
    // Security: path validation (S4-S6)
    // -----------------------------------------------------------------------

    #[test]
    fn validate_read_path_allows_normal_files() {
        // /etc/hosts exists on all unix systems and is not blocked
        let result = validate_read_path("/etc/hosts");
        assert!(
            result.is_ok(),
            "Should allow reading /etc/hosts: {result:?}"
        );
    }

    #[test]
    fn validate_read_path_blocks_ssh_dir() {
        let home = std::env::var("HOME").unwrap();
        let ssh_key = format!("{home}/.ssh/id_rsa");
        let result = validate_read_path(&ssh_key);
        assert!(result.is_err(), "Should block reading ~/.ssh/id_rsa");
        assert!(result.unwrap_err().contains("Access denied"));
    }

    #[test]
    fn validate_read_path_blocks_gnupg_dir() {
        let home = std::env::var("HOME").unwrap();
        let gpg = format!("{home}/.gnupg/trustdb.gpg");
        let result = validate_read_path(&gpg);
        // Rejected either because dir doesn't exist (canonicalize fails)
        // or because it's in the blocklist — both are safe outcomes
        assert!(result.is_err(), "Should block reading ~/.gnupg/");
    }

    #[test]
    fn validate_read_path_blocks_aws_credentials() {
        let home = std::env::var("HOME").unwrap();
        let aws = format!("{home}/.aws/credentials");
        let result = validate_read_path(&aws);
        assert!(result.is_err(), "Should block reading ~/.aws/credentials");
    }

    #[test]
    fn validate_read_path_rejects_nonexistent_file() {
        let result = validate_read_path("/nonexistent/path/to/file.txt");
        assert!(result.is_err(), "Should reject nonexistent paths");
    }

    #[test]
    fn validate_write_path_allows_config_dir() {
        let home = std::env::var("HOME").unwrap();
        let config = format!("{home}/.config/gnar-term/gnar-term.json");
        let result = validate_write_path(&config);
        assert!(
            result.is_ok(),
            "Should allow writing to ~/.config/gnar-term/: {result:?}"
        );
    }

    #[test]
    fn validate_write_path_blocks_home_dir() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.bashrc");
        let result = validate_write_path(&path);
        assert!(result.is_err(), "Should block writing to ~/.bashrc");
        assert!(result.unwrap_err().contains("Write denied"));
    }

    #[test]
    fn validate_write_path_blocks_system_paths() {
        let result = validate_write_path("/etc/passwd");
        assert!(result.is_err(), "Should block writing to /etc/passwd");
    }

    #[test]
    fn validate_write_path_blocks_traversal() {
        let home = std::env::var("HOME").unwrap();
        let traversal = format!("{home}/.config/gnar-term/../../.bashrc");
        let result = validate_write_path(&traversal);
        assert!(result.is_err(), "Should block path traversal via ../");
    }

    #[test]
    fn validate_write_path_allows_nested_config() {
        let home = std::env::var("HOME").unwrap();
        let nested = format!("{home}/.config/gnar-term/themes/custom.json");
        let result = validate_write_path(&nested);
        assert!(
            result.is_ok(),
            "Should allow nested paths under config dir: {result:?}"
        );
    }

    // -----------------------------------------------------------------------
    // Bug fix: OSC 7 CWD parsing (B2)
    // -----------------------------------------------------------------------

    #[test]
    fn osc7_parse_empty_hostname() {
        // file:///Users/foo → /Users/foo
        let url = "file:///Users/foo";
        let path = url.strip_prefix("file://").unwrap();
        let cwd = if path.starts_with('/') {
            path.to_string()
        } else if let Some(slash_idx) = path.find('/') {
            path[slash_idx..].to_string()
        } else {
            path.to_string()
        };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn osc7_parse_with_hostname() {
        // file://myhost/Users/foo → /Users/foo
        let url = "file://myhost/Users/foo";
        let path = url.strip_prefix("file://").unwrap();
        let cwd = if path.starts_with('/') {
            path.to_string()
        } else if let Some(slash_idx) = path.find('/') {
            path[slash_idx..].to_string()
        } else {
            path.to_string()
        };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn osc7_parse_no_scheme() {
        let url = "/Users/foo".to_string();
        let cwd = if let Some(path) = url.strip_prefix("file://") {
            if path.starts_with('/') {
                path.to_string()
            } else if let Some(slash_idx) = path.find('/') {
                path[slash_idx..].to_string()
            } else {
                path.to_string()
            }
        } else {
            url.clone()
        };
        assert_eq!(cwd, "/Users/foo");
    }

    // -----------------------------------------------------------------------
    // Bug fix: PID cast safety (B1)
    // -----------------------------------------------------------------------

    #[test]
    fn pid_i32_cast_rejects_overflow() {
        let big_pid: u32 = u32::MAX;
        let result = i32::try_from(big_pid);
        assert!(result.is_err(), "i32::try_from(u32::MAX) should fail");
    }

    #[test]
    fn pid_i32_cast_accepts_normal_pid() {
        let normal_pid: u32 = 12345;
        let result = i32::try_from(normal_pid);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 12345);
    }

    // -----------------------------------------------------------------------
    // PTY spawn and output (T1)
    // -----------------------------------------------------------------------

    #[test]
    fn pty_spawn_returns_valid_id_and_is_tracked() {
        let state = AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("echo HELLO; sleep 0.1");

        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let child_pid = child.process_id();
        drop(pair.slave);

        let writer = pair.master.take_writer().expect("Failed to get writer");
        let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);
        assert!(pty_id > 0, "PTY ID should be positive");

        let paused = Arc::new(PauseFlag::new());
        {
            let mut ptys = state.ptys.lock().unwrap();
            ptys.insert(
                pty_id,
                PtyInstance {
                    writer,
                    master_pty: pair.master,
                    child_pid,
                    paused,
                },
            );
        }

        // Verify the PTY is tracked in the map
        let ptys = state.ptys.lock().unwrap();
        assert!(ptys.contains_key(&pty_id), "PTY should be in the state map");
        assert!(
            ptys.get(&pty_id).unwrap().child_pid.is_some(),
            "PTY should have a child PID"
        );
    }

    // -----------------------------------------------------------------------
    // PTY write and read output (T1b)
    // -----------------------------------------------------------------------

    #[test]
    fn pty_write_and_read_echo_output() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let cmd = CommandBuilder::new("cat");
        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);

        let mut writer = pair.master.take_writer().expect("Failed to get writer");
        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("Failed to get reader");

        // Write to the PTY
        writer.write_all(b"HELLO\n").expect("Failed to write");
        drop(writer); // Close stdin so cat exits

        // Read output
        let mut output = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => output.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
        }
        let output_str = String::from_utf8_lossy(&output);
        assert!(
            output_str.contains("HELLO"),
            "Should see echoed input, got: {output_str}"
        );
    }

    // -----------------------------------------------------------------------
    // PTY resize (T2)
    // -----------------------------------------------------------------------

    #[test]
    fn pty_resize_does_not_panic() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("sleep 1");
        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);

        // Resize to 120x40
        let result = pair.master.resize(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        });
        assert!(result.is_ok(), "Resize should succeed: {:?}", result.err());

        // Resize to very small
        let result = pair.master.resize(PtySize {
            rows: 1,
            cols: 1,
            pixel_width: 0,
            pixel_height: 0,
        });
        assert!(
            result.is_ok(),
            "Resize to 1x1 should succeed: {:?}",
            result.err()
        );
    }

    // -----------------------------------------------------------------------
    // PTY kill / removal from map (T3)
    // -----------------------------------------------------------------------

    #[test]
    fn pty_kill_removes_from_state() {
        let state = AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("sleep 60");
        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let child_pid = child.process_id();
        drop(pair.slave);

        let writer = pair.master.take_writer().expect("Failed to get writer");
        let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);
        let paused = Arc::new(PauseFlag::new());

        {
            let mut ptys = state.ptys.lock().unwrap();
            ptys.insert(
                pty_id,
                PtyInstance {
                    writer,
                    master_pty: pair.master,
                    child_pid,
                    paused: paused.clone(),
                },
            );
        }

        // Verify it's in the map
        assert!(state.ptys.lock().unwrap().contains_key(&pty_id));

        // Kill: remove from map and signal process
        {
            let mut ptys = state.ptys.lock().unwrap();
            if let Some(pty) = ptys.remove(&pty_id) {
                pty.paused.resume();
                if let Some(pid) = pty.child_pid {
                    #[cfg(unix)]
                    unsafe {
                        let pid_i32 = pid as i32;
                        libc::kill(pid_i32, libc::SIGKILL);
                    }
                }
            }
        }

        // Verify it's gone
        assert!(
            !state.ptys.lock().unwrap().contains_key(&pty_id),
            "PTY should be removed from map after kill"
        );
    }

    // -----------------------------------------------------------------------
    // File read/write roundtrip (T4)
    // -----------------------------------------------------------------------

    #[test]
    fn file_read_write_roundtrip() {
        let home = std::env::var("HOME").unwrap();
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
        assert!(
            encoded.len().is_multiple_of(4),
            "Base64 output length should be multiple of 4"
        );
        // Known base64 for this sequence
        assert_eq!(encoded, "G1szMW1IZWxsbxtbMG0=");
    }

    #[test]
    fn b64_encode_binary_data() {
        // All byte values 0x00..0xFF
        let data: Vec<u8> = (0..=255).collect();
        let encoded = b64_encode(&data);
        assert!(!encoded.is_empty());
        assert!(
            encoded.len().is_multiple_of(4),
            "Base64 output should be padded to multiple of 4"
        );
    }

    // -----------------------------------------------------------------------
    // Ensure dir (T7)
    // -----------------------------------------------------------------------

    #[test]
    fn ensure_dir_creates_nested_directory() {
        let home = std::env::var("HOME").unwrap();
        let test_dir = format!("{home}/.config/gnar-term/test-tmp/nested/deep/dir");

        // Remove if leftover from a previous run
        let _ = std::fs::remove_dir_all(format!("{home}/.config/gnar-term/test-tmp/nested"));

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

    // -----------------------------------------------------------------------
    // PTY spawns in specified cwd and get_pty_cwd returns it (T9)
    // -----------------------------------------------------------------------

    #[test]
    fn pty_spawn_with_cwd_and_get_cwd() {
        let state = AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("Failed to open PTY");

        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("sleep 2");
        cmd.cwd("/tmp");

        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let child_pid = child.process_id();
        drop(pair.slave);

        let writer = pair.master.take_writer().expect("Failed to get writer");
        let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);

        let paused = Arc::new(PauseFlag::new());
        {
            let mut ptys = state.ptys.lock().unwrap();
            ptys.insert(
                pty_id,
                PtyInstance {
                    writer,
                    master_pty: pair.master,
                    child_pid,
                    paused,
                },
            );
        }

        // Give the process a moment to start
        std::thread::sleep(Duration::from_millis(200));

        // Verify get_pty_cwd returns the correct directory
        if let Some(pid) = child_pid {
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("lsof")
                    .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
                    .output()
                    .expect("lsof should run");
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut found_cwd = String::new();
                for line in stdout.lines() {
                    if let Some(path) = line.strip_prefix('n') {
                        if path.starts_with('/') {
                            found_cwd = path.to_string();
                            break;
                        }
                    }
                }
                // /tmp is a symlink to /private/tmp on macOS
                assert!(
                    found_cwd == "/tmp" || found_cwd == "/private/tmp",
                    "CWD should be /tmp or /private/tmp, got: {found_cwd}"
                );
            }
        } else {
            panic!("Child PID should be available");
        }
    }

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

    // --- OSC classifier tests (issue #20) ---

    #[test]
    fn osc9_plain_text_is_notification() {
        assert_eq!(
            classify_osc("9;Build complete"),
            OscAction::Notification("Build complete".into())
        );
    }

    #[test]
    fn osc9_subcommand_is_ignored() {
        // "4;0;" is a color-query / sub-command, not a notification
        assert_eq!(classify_osc("9;4;0;"), OscAction::Ignore);
        assert_eq!(classify_osc("9;4;0;rgb:0000/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn osc99_plain_text_is_notification() {
        assert_eq!(
            classify_osc("99;Hello from kitty"),
            OscAction::Notification("Hello from kitty".into())
        );
    }

    #[test]
    fn osc777_plain_text_is_notification() {
        assert_eq!(
            classify_osc("777;notify;Title;Body text"),
            OscAction::Notification("notify;Title;Body text".into())
        );
    }

    #[test]
    fn osc0_sets_title() {
        assert_eq!(
            classify_osc("0;my terminal title"),
            OscAction::Title("my terminal title".into())
        );
    }

    #[test]
    fn osc2_sets_title() {
        assert_eq!(
            classify_osc("2;window name"),
            OscAction::Title("window name".into())
        );
    }

    #[test]
    fn osc_unknown_is_ignored() {
        assert_eq!(classify_osc("52;c;dGVzdA=="), OscAction::Ignore);
        assert_eq!(classify_osc("4;1;rgb:ffff/0000/0000"), OscAction::Ignore);
    }

    #[test]
    fn osc9_empty_payload_is_ignored() {
        assert_eq!(classify_osc("9;"), OscAction::Ignore);
    }

    #[test]
    fn osc9_text_starting_with_letter_is_notification() {
        assert_eq!(
            classify_osc("9;3 new emails"),
            OscAction::Notification("3 new emails".into())
        );
    }

    #[test]
    fn osc9_number_without_semicolon_is_notification() {
        // A payload like "9;42" — just a number, no sub-command semicolon
        assert_eq!(classify_osc("9;42"), OscAction::Notification("42".into()));
    }

    // -----------------------------------------------------------------------
    // filter_known_args tests
    // -----------------------------------------------------------------------

    fn args(strs: &[&str]) -> Vec<String> {
        strs.iter().map(std::string::ToString::to_string).collect()
    }

    #[test]
    fn filter_keeps_positional_path() {
        let input = args(&["gnar-term", "/home/user"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_keeps_known_flags() {
        let input = args(&["gnar-term", "-d", "/tmp", "-e", "vim", "--title", "My Term"]);
        assert_eq!(filter_known_args(input.clone().into_iter()), input);
    }

    #[test]
    fn filter_keeps_flag_equals_form() {
        let input = args(&["gnar-term", "--working-directory=/tmp"]);
        assert_eq!(filter_known_args(input.clone().into_iter()), input);
    }

    #[test]
    fn filter_drops_unknown_standalone_flags() {
        let input = args(&["gnar-term", "--no-default-features", "/home/user"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_drops_unknown_flag_with_space_value() {
        // --color always (space-separated) — both must be dropped.
        let input = args(&["gnar-term", "--color", "always", "/home/user"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_drops_unknown_flag_followed_by_another_flag() {
        // --color followed by --no-default-features — don't consume the next flag as a value.
        let input = args(&[
            "gnar-term",
            "--color",
            "--no-default-features",
            "/home/user",
        ]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_drops_unknown_equals_flag() {
        let input = args(&["gnar-term", "--color=always", "/home/user"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_drops_psn_arg() {
        let input = args(&["gnar-term", "-psn_0_12345", "/home/user"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_preserves_args_after_double_dash() {
        let input = args(&["gnar-term", "--", "--not-a-flag", "foo"]);
        assert_eq!(filter_known_args(input.clone().into_iter()), input);
    }

    #[test]
    fn filter_mixed_known_unknown_and_positional() {
        let input = args(&[
            "gnar-term",
            "--color",
            "-w",
            "dev",
            "--no-default-features",
            "-e",
            "bash",
            "--unknown",
            "~/Documents",
        ]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "-w", "dev", "-e", "bash", "~/Documents"])
        );
    }
}
