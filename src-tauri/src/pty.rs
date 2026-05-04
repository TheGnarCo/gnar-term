//! PTY management commands and OSC parsing.
//!
//! `AppState` is the Tauri-managed state container shared by both the PTY
//! commands here and the file-watcher commands in `file_watch`. Keeping the
//! PTY map and the watch-flag map together lets a single `state` parameter
//! carry both lifetimes through the IPC layer.

use crate::fs_commands::global_config_dir;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

pub(crate) static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);

/// Classification of a parsed OSC sequence.
#[derive(Debug, PartialEq)]
pub(crate) enum OscAction {
    /// A user-facing notification (OSC 9 / 99 / 777).
    Notification(String),
    /// A window/tab title update (OSC 0 / 2).
    Title(String),
    /// An OSC we don't handle — ignore it.
    Ignore,
}

/// Sanitize a notification text string received from PTY output.
///
/// Strips C0/C1 control characters (U+0000–U+001F, U+007F, U+0080–U+009F)
/// and limits the result to 500 characters to prevent malicious PTY output
/// from injecting control sequences into system notifications.
pub(crate) fn sanitize_notification(text: &str) -> String {
    text.chars()
        .filter(|&c| {
            let n = c as u32;
            // Exclude C0 (0x00–0x1F), DEL (0x7F), and C1 (0x80–0x9F)
            !(n <= 0x1F || n == 0x7F || (0x80..=0x9F).contains(&n))
        })
        .take(500)
        .collect()
}

/// Classify a raw OSC payload (the bytes between `ESC]` and `BEL`/`ST`).
///
/// Returns an `OscAction` describing what the sequence means.
pub(crate) fn classify_osc(raw: &str) -> OscAction {
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

    // OSC 777's xterm/urxvt-style notification payload is
    // `notify;<title>;<body>` — Claude Code uses this. Parsing it here
    // keeps the raw "notify;Claude Code;…" string out of the UI so the
    // workspace row shows "Claude Code: <body>" instead.
    if let Some(rest) = text.strip_prefix("notify;") {
        let (title, body) = rest.split_once(';').unwrap_or((rest, ""));
        let title = title.trim();
        let body = body.trim();
        let formatted = match (title.is_empty(), body.is_empty()) {
            (true, true) => return OscAction::Ignore,
            (false, true) => title.to_string(),
            (true, false) => body.to_string(),
            (false, false) => format!("{title}: {body}"),
        };
        return OscAction::Notification(sanitize_notification(&formatted));
    }

    OscAction::Notification(sanitize_notification(text))
}

/// Shared pause state — uses a Condvar so the reader thread blocks efficiently
/// instead of spin-waiting when the frontend signals backpressure.
pub(crate) struct PauseFlag {
    mu: std::sync::Mutex<bool>,
    cv: std::sync::Condvar,
}

impl PauseFlag {
    pub(crate) fn new() -> Self {
        Self {
            mu: std::sync::Mutex::new(false),
            cv: std::sync::Condvar::new(),
        }
    }
    pub(crate) fn pause(&self) {
        *self
            .mu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
    }
    pub(crate) fn resume(&self) {
        *self
            .mu
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = false;
        self.cv.notify_one();
    }
    pub(crate) fn wait_if_paused(&self) {
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

pub(crate) struct PtyInstance {
    pub(crate) writer: Box<dyn Write + Send>,
    // master is kept alive to keep the PTY open
    pub(crate) master_pty: Box<dyn MasterPty + Send>,
    pub(crate) child_pid: Option<u32>,
    pub(crate) paused: std::sync::Arc<PauseFlag>,
}

pub(crate) struct AppState {
    pub(crate) ptys: Mutex<HashMap<u32, PtyInstance>>,
    pub(crate) watch_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
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
    exit_code: Option<i32>,
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
#[allow(clippy::too_many_arguments)]
pub(crate) async fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_output: Channel<InvokeResponseBody>,
    extra_env: Option<HashMap<String, String>>,
    shell: Option<String>,
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

    // Spawn shell — use config-provided shell if set, otherwise system default ($SHELL)
    let mut cmd = match shell {
        Some(ref s) if !s.is_empty() => CommandBuilder::new(s),
        _ => CommandBuilder::new_default_prog(),
    };
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
    let config_dir = global_config_dir().unwrap_or_else(|_| format!("{home}/.config/gnar-term"));
    let integration_dir = format!("{config_dir}/shell");
    let _ = std::fs::create_dir_all(&integration_dir);

    // zsh: ZDOTDIR override
    let zshenv = r#"# GnarTerm shell integration
[ -f "$GNARTERM_ORIG_ZDOTDIR/.zshenv" ] && source "$GNARTERM_ORIG_ZDOTDIR/.zshenv"
export ZDOTDIR="$GNARTERM_ORIG_ZDOTDIR"
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
_gnarterm_cmd_running() { printf '\e]0;Running: %s\a' "$1"; }
precmd_functions+=(_gnarterm_report_cwd)
chpwd_functions+=(_gnarterm_report_cwd)
preexec_functions+=(_gnarterm_cmd_running)
"#;
    let _ = std::fs::write(format!("{integration_dir}/.zshenv"), zshenv);
    let orig_zdotdir = std::env::var("ZDOTDIR").unwrap_or(home.clone());
    cmd.env("GNARTERM_ORIG_ZDOTDIR", &orig_zdotdir);
    cmd.env("ZDOTDIR", &integration_dir);

    // bash: use GNARTERM_SHELL_INTEGRATION env var
    // Bash users can add to .bashrc: [ -n "$GNARTERM_SHELL_INTEGRATION" ] && source "$GNARTERM_SHELL_INTEGRATION"
    let bash_integration = format!("{config_dir}/shell/bash-integration.sh");
    let bash_content = r#"# GnarTerm bash integration
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
PROMPT_COMMAND="_gnarterm_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
"#;
    let _ = std::fs::write(&bash_integration, bash_content);
    cmd.env("GNARTERM_SHELL_INTEGRATION", &bash_integration);

    // fish: write to conf.d for zero-config auto-sourcing (same as starship, zoxide, etc.)
    // Also write to gnar-term's shell dir as a reference copy.
    let fish_content = "# GnarTerm fish integration — auto-sourced from conf.d\n\
function __gnarterm_report_cwd --on-event fish_prompt\n\
    printf '\\e]7;file://%s%s\\a' (hostname) $PWD\nend\n";
    let _ = std::fs::write(
        format!("{integration_dir}/fish-integration.fish"),
        fish_content,
    );
    let fish_conf_d = format!("{home}/.config/fish/conf.d");
    if std::fs::metadata(&fish_conf_d).is_ok_and(|m| m.is_dir()) {
        let _ = std::fs::write(format!("{fish_conf_d}/gnarterm.fish"), fish_content);
    }

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
                    let _ = app_handle.emit(
                        "pty-exit",
                        PtyExit {
                            pty_id: id,
                            exit_code: None,
                        },
                    );
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
                    let _ = app_handle.emit(
                        "pty-exit",
                        PtyExit {
                            pty_id: id,
                            exit_code: None,
                        },
                    );
                    break;
                }
            }
        }
    });

    Ok(pty_id)
}

/// Write data to a PTY
#[tauri::command]
pub(crate) async fn write_pty(
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
pub(crate) async fn resize_pty(
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
pub(crate) async fn kill_pty(state: tauri::State<'_, AppState>, pty_id: u32) -> Result<(), String> {
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

/// Pause PTY reader (flow control — frontend buffer is full)
#[tauri::command]
pub(crate) async fn pause_pty(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.get(&pty_id) {
        pty.paused.pause();
    }
    Ok(())
}

/// Resume PTY reader (flow control — frontend buffer drained)
#[tauri::command]
pub(crate) async fn resume_pty(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.get(&pty_id) {
        pty.paused.resume();
    }
    Ok(())
}

/// Get the child process PID for a PTY, if known.
#[tauri::command]
pub(crate) async fn get_pty_pid(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<Option<u32>, String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    Ok(ptys.get(&pty_id).and_then(|p| p.child_pid))
}

/// Get the title for a PTY tab — foreground process name or cwd basename
#[tauri::command]
pub(crate) async fn get_pty_title(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<String, String> {
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
                if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
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
pub(crate) async fn get_pty_cwd(
    state: tauri::State<'_, AppState>,
    pty_id: u32,
) -> Result<String, String> {
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
                if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
                    return Ok(path.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(String::new())
}

/// Get the working directory for every live PTY in a single call.
///
/// Returns a map of ptyId (as string) → absolute cwd path.  Missing entries
/// mean the pid is unavailable or the cwd could not be read; callers should
/// treat a missing key as "no change".
///
/// The mutex is acquired only long enough to snapshot `(pty_id, pid)` pairs,
/// then released before any subprocess work, avoiding holding the lock while
/// spawning N lsof processes.
#[tauri::command]
pub(crate) async fn get_all_pty_cwds(
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    // Snapshot ids+pids under the lock, then release immediately.
    let pid_map: Vec<(u32, u32)> = {
        let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
        ptys.iter()
            .filter_map(|(&id, entry)| entry.child_pid.map(|pid| (id, pid)))
            .collect()
    };

    let mut result = std::collections::HashMap::new();

    for (pty_id, pid) in pid_map {
        #[cfg(target_os = "macos")]
        {
            let output = std::process::Command::new("lsof")
                .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
                .output();
            if let Ok(output) = output {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if let Some(path) = line.strip_prefix('n') {
                        if path.starts_with('/') {
                            result.insert(pty_id.to_string(), path.to_string());
                            break;
                        }
                    }
                }
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
                result.insert(pty_id.to_string(), path.to_string_lossy().to_string());
            }
        }
    }

    Ok(result)
}
