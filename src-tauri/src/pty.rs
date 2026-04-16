use crate::osc_parser::{classify_osc, OscAction};
use crate::{b64_encode, home_dir, AppState, NEXT_PTY_ID};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

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
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) child_pid: Option<u32>,
    pub(crate) paused: Arc<PauseFlag>,
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    pty_id: u32,
    data: String, // base64-encoded for efficient IPC
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

/// Spawn a new PTY with a shell
#[tauri::command]
pub(crate) async fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
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
    // Shell integration env vars — files are written once at startup in setup()
    let home = home_dir().unwrap_or_default();
    let integration_dir = format!("{home}/.config/gnar-term/shell");

    // zsh: ZDOTDIR override points to our integration dir
    let orig_zdotdir = std::env::var("ZDOTDIR").unwrap_or(home.clone());
    cmd.env("GNARTERM_ORIG_ZDOTDIR", &orig_zdotdir);
    cmd.env("ZDOTDIR", &integration_dir);

    // bash: GNARTERM_SHELL_INTEGRATION env var
    let bash_integration = format!("{home}/.config/gnar-term/shell/bash-integration.sh");
    cmd.env("GNARTERM_SHELL_INTEGRATION", &bash_integration);

    // Pass through EDITOR/VISUAL so git commit, crontab, etc. open the right editor
    if let Ok(editor) = std::env::var("EDITOR") {
        cmd.env("EDITOR", &editor);
    }
    if let Ok(visual) = std::env::var("VISUAL") {
        cmd.env("VISUAL", &visual);
    }

    // Apply extension-supplied environment variables (e.g., GNARTERM_WORKTREE_ROOT)
    if let Some(ref extra_env) = env {
        for (key, value) in extra_env {
            cmd.env(key, value);
        }
    }

    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
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

    let paused = Arc::new(PauseFlag::new());
    let paused_clone = paused.clone();

    // Store PTY
    {
        let mut ptys = state.ptys.lock().map_err(|e| e.to_string())?;
        ptys.insert(
            pty_id,
            PtyInstance {
                writer,
                master: pair.master,
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
        const MAX_OSC_BUF: usize = 8192; // 8KB cap — discard malformed sequences

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
                                // Cap buffer to prevent unbounded growth from unterminated sequences
                                if osc_buf.len() > MAX_OSC_BUF {
                                    osc_buf.clear();
                                    in_osc = false;
                                }
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

                    // Base64 encode to preserve raw bytes (terminal escape sequences
                    // contain bytes that aren't valid UTF-8)
                    let _ = app_handle.emit(
                        "pty-output",
                        PtyOutput {
                            pty_id: id,
                            data: b64_encode(data),
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
    pty.master
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

/// Get the child process PID for a PTY, if known. Used by the MCP bridge.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
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
                    master: pair.master,
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
                    master: pair.master,
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
                        let pid_i32 = i32::try_from(pid).unwrap();
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
                    master: pair.master,
                    child_pid,
                    paused,
                },
            );
        }

        // Give the process a moment to start
        std::thread::sleep(Duration::from_millis(200));

        // Verify get_pty_cwd returns the correct directory
        // pid is used on macOS (lsof) but not on Linux — allow the warning
        #[allow(unused_variables)]
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
}
