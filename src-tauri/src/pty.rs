use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Once;
use tauri::{AppHandle, Emitter};

static SHELL_INIT: Once = Once::new();

use crate::b64;
use crate::osc::{classify_osc, OscAction};

pub static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);

/// Shared pause state — uses a Condvar so the reader thread blocks efficiently
/// instead of spin-waiting when the frontend signals backpressure.
pub struct PauseFlag {
    mu: std::sync::Mutex<bool>,
    cv: std::sync::Condvar,
}

impl PauseFlag {
    pub fn new() -> Self {
        Self { mu: std::sync::Mutex::new(false), cv: std::sync::Condvar::new() }
    }
    pub fn pause(&self) {
        *self.mu.lock().unwrap_or_else(|e| e.into_inner()) = true;
    }
    pub fn resume(&self) {
        *self.mu.lock().unwrap_or_else(|e| e.into_inner()) = false;
        self.cv.notify_one();
    }
    pub fn wait_if_paused(&self) {
        let guard = self.mu.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = self.cv.wait_while(guard, |paused| *paused)
            .unwrap_or_else(|e| e.into_inner());
    }
}

pub struct PtyInstance {
    pub writer: Box<dyn Write + Send>,
    pub _master: Box<dyn MasterPty + Send>,
    pub child_pid: Option<u32>,
    pub paused: std::sync::Arc<PauseFlag>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    pty_id: u32,
    data: String,
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
    exit_code: Option<u32>,
}

/// Spawn a new PTY with a shell
#[tauri::command]
pub async fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, crate::AppState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
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
    cmd.env("TERM_PROGRAM", "GnarTerm");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

    let home = std::env::var("HOME").unwrap_or_default();
    let integration_dir = format!("{}/.config/gnar/shell", home);
    let orig_zdotdir = std::env::var("ZDOTDIR").unwrap_or(home.clone());

    SHELL_INIT.call_once(|| {
        let _ = std::fs::create_dir_all(&integration_dir);

        let zshenv = r#"# GnarTerm shell integration
[ -f "$GNARTERM_ORIG_ZDOTDIR/.zshenv" ] && source "$GNARTERM_ORIG_ZDOTDIR/.zshenv"
export ZDOTDIR="$GNARTERM_ORIG_ZDOTDIR"
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
precmd_functions+=(_gnarterm_report_cwd)
chpwd_functions+=(_gnarterm_report_cwd)
# Worktree boundary enforcement — prevents cd outside the worktree root
if [ -n "$GNARTERM_WORKTREE_ROOT" ]; then
  _gnarterm_enforce_worktree() {
    case "$PWD" in
      "$GNARTERM_WORKTREE_ROOT"*) ;;
      *) cd "$GNARTERM_WORKTREE_ROOT" && echo "gnarterm: stayed in worktree" ;;
    esac
  }
  chpwd_functions+=(_gnarterm_enforce_worktree)
fi
"#;
        let _ = std::fs::write(format!("{}/.zshenv", integration_dir), zshenv);

        let bash_integration = format!("{}/bash-integration.sh", integration_dir);
        let bash_content = r#"# GnarTerm bash integration
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
PROMPT_COMMAND="_gnarterm_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
"#;
        let _ = std::fs::write(&bash_integration, bash_content);
    });

    cmd.env("GNARTERM_ORIG_ZDOTDIR", &orig_zdotdir);
    cmd.env("ZDOTDIR", &integration_dir);
    let bash_integration = format!("{}/bash-integration.sh", integration_dir);
    cmd.env("GNARTERM_SHELL_INTEGRATION", &bash_integration);

    if let Some(ref env_vars) = env {
        for (key, val) in env_vars {
            cmd.env(key, val);
        }
    }

    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    let mut child = pair.slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let child_pid = child.process_id();

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {e}"))?;

    let paused = std::sync::Arc::new(PauseFlag::new());
    let paused_clone = paused.clone();

    {
        let mut ptys = state.ptys.lock().map_err(|e| e.to_string())?;
        ptys.insert(
            pty_id,
            PtyInstance {
                writer,
                _master: pair.master,
                child_pid,
                paused: paused_clone,
            },
        );
    }

    // Spawn reader thread — forwards PTY output to frontend.
    // `child` is moved here so we can call wait() after EOF to get exit status.
    let app_handle = app.clone();
    let id = pty_id;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let paused_flag = paused.clone();
        let mut osc_buf = Vec::new();
        let mut in_osc = false;
        let mut prev_esc = false;

        loop {
            paused_flag.wait_if_paused();
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let exit_code = child.wait()
                        .map(|status| if status.success() { 0u32 } else { 1u32 })
                        .ok();
                    // CONTRACT: The frontend MUST call kill_pty(pty_id) after receiving
                    // this event to clean up the PtyInstance from AppState. The reader
                    // thread cannot access AppState to self-cleanup.
                    let _ = app_handle.emit("pty-exit", PtyExit { pty_id: id, exit_code });
                    break;
                }
                Ok(n) => {
                    let data = &buf[..n];

                    let mut prev_byte_in_osc: u8 = 0;
                    for &byte in data {
                        if in_osc {
                            // Single-byte terminators: BEL (0x07) or ST (0x9C)
                            // Two-byte ST: ESC (0x1B) followed by 0x5C
                            let is_two_byte_st = byte == 0x5c && prev_byte_in_osc == 0x1b;
                            if byte == 0x07 || byte == 0x9c || is_two_byte_st {
                                // Remove trailing ESC from buffer if two-byte ST
                                if is_two_byte_st {
                                    osc_buf.pop();
                                }
                                if let Ok(s) = String::from_utf8(osc_buf.clone()) {
                                    match classify_osc(&s) {
                                        OscAction::Notification(text) => {
                                            let _ = app_handle.emit(
                                                "pty-notification",
                                                PtyNotification { pty_id: id, text },
                                            );
                                        }
                                        OscAction::Title(title) => {
                                            let _ = app_handle.emit(
                                                "pty-title",
                                                PtyTitle { pty_id: id, title },
                                            );
                                        }
                                        OscAction::Ignore => {}
                                    }
                                }
                                osc_buf.clear();
                                in_osc = false;
                            } else {
                                osc_buf.push(byte);
                                // L1: Prevent unbounded OSC buffer growth
                                if osc_buf.len() > 4096 {
                                    osc_buf.clear();
                                    in_osc = false;
                                }
                            }
                            prev_byte_in_osc = byte;
                        } else if byte == 0x1b {
                            prev_esc = true;
                        } else if byte == 0x5d && prev_esc {
                            in_osc = true;
                            osc_buf.clear();
                            prev_esc = false;
                            prev_byte_in_osc = 0;
                        } else {
                            prev_esc = false;
                        }
                    }

                    let _ = app_handle.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: id,
                            data: b64::encode(data),
                        },
                    );
                }
            }
        }
    });

    Ok(pty_id)
}

/// Write data to a PTY
#[tauri::command]
pub async fn write_pty(
    state: tauri::State<'_, crate::AppState>,
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
pub async fn resize_pty(
    state: tauri::State<'_, crate::AppState>,
    pty_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
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
pub async fn kill_pty(state: tauri::State<'_, crate::AppState>, pty_id: u32) -> Result<(), String> {
    let mut ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.remove(&pty_id) {
        pty.paused.resume();

        if let Some(pid) = pty.child_pid {
            #[cfg(unix)]
            {
                let pid_i32 = i32::try_from(pid).map_err(|_| format!("PID {} exceeds i32::MAX", pid))?;
                unsafe { libc::kill(-pid_i32, libc::SIGKILL); }
                unsafe { libc::kill(pid_i32, libc::SIGKILL); }
            }
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill").args(["/F", "/T", "/PID", &pid.to_string()]).output();
            }
        }
    }
    Ok(())
}

/// Pause PTY reader (flow control — frontend buffer is full)
#[tauri::command]
pub async fn pause_pty(state: tauri::State<'_, crate::AppState>, pty_id: u32) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.get(&pty_id) {
        pty.paused.pause();
    }
    Ok(())
}

/// Resume PTY reader (flow control — frontend buffer drained)
#[tauri::command]
pub async fn resume_pty(state: tauri::State<'_, crate::AppState>, pty_id: u32) -> Result<(), String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(pty) = ptys.get(&pty_id) {
        pty.paused.resume();
    }
    Ok(())
}

/// Get the title for a PTY tab — foreground process name or cwd basename
#[tauri::command]
pub async fn get_pty_title(state: tauri::State<'_, crate::AppState>, pty_id: u32) -> Result<String, String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = ptys.get(&pty_id) {
        if let Some(pid) = entry.child_pid {
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("ps")
                    .args(["-o", "comm=", "-g", &pid.to_string()])
                    .output();
                if let Ok(out) = output {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let procs: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
                    if let Some(last) = procs.last() {
                        let name = last.rsplit('/').next().unwrap_or(last).trim();
                        if !name.is_empty() && name != "zsh" && name != "bash" && name != "fish" && name != "sh" {
                            return Ok(name.to_string());
                        }
                    }
                }
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
pub async fn get_pty_cwd(state: tauri::State<'_, crate::AppState>, pty_id: u32) -> Result<String, String> {
    let ptys = state.ptys.lock().map_err(|e| e.to_string())?;
    if let Some(entry) = ptys.get(&pty_id) {
        if let Some(pid) = entry.child_pid {
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("lsof")
                    .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
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
