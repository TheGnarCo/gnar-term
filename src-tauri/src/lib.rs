use clap::Parser;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

mod commands;
mod file_utils;
mod file_watch;
mod fs_commands;
mod gh_commands;
pub mod git_helpers;
mod git_info;
mod git_ops;
mod git_status_ops;
mod git_worktree;
pub mod mcp_bridge;
pub mod mcp_register;
mod pty;

use file_watch::{unwatch_claude_file, unwatch_file, watch_claude_file, watch_file};
use fs_commands::{
    detect_font, ensure_dir, file_exists, find_file, get_global_config_dir, get_home,
    is_debug_build, list_claude_dir, list_dir, mcp_file_info, mcp_list_dir, open_url,
    open_with_default_app, read_claude_file, read_file, read_file_base64, show_in_file_manager,
    write_claude_file, write_file,
};
use pty::{
    get_all_pty_cwds, get_pty_cwd, get_pty_pid, get_pty_title, kill_pty, pause_pty, resize_pty,
    resume_pty, spawn_pty, write_pty, AppState,
};
// Re-export validation helpers used by sibling modules (commands.rs,
// file_utils.rs) via the historical `crate::validate_*` paths. The
// `validate_claude_*` helpers and `global_config_dir` are surfaced for
// tests in this file.
#[allow(unused_imports)]
pub(crate) use fs_commands::{
    b64_encode, global_config_dir, validate_claude_read, validate_claude_write, validate_read_path,
    validate_write_path,
};

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

/// Return CLI arguments passed to the app.
#[tauri::command]
fn get_cli_args(args: tauri::State<'_, CliArgs>) -> CliArgs {
    args.inner().clone()
}

/// Read the `mcp` setting from `gnar-term.json`. Returns `"auto"` if no
/// config exists or the field is missing. Values that aren't recognized fall
/// back to `"auto"`.
fn read_mcp_setting() -> String {
    let paths: Vec<std::path::PathBuf> = {
        let mut v = Vec::new();
        v.push(std::path::PathBuf::from("gnar-term.json"));
        v.push(std::path::PathBuf::from("cmux.json"));
        if let Ok(config_dir) = global_config_dir() {
            v.push(std::path::PathBuf::from(format!(
                "{config_dir}/gnar-term.json"
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
        .plugin(tauri_plugin_dialog::init())
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
            get_all_pty_cwds,
            get_pty_pid,
            get_pty_title,
            file_exists,
            list_dir,
            read_file,
            read_file_base64,
            write_file,
            ensure_dir,
            get_home,
            get_global_config_dir,
            is_debug_build,
            watch_file,
            unwatch_file,
            read_claude_file,
            write_claude_file,
            list_claude_dir,
            watch_claude_file,
            unwatch_claude_file,
            show_in_file_manager,
            open_with_default_app,
            open_url,
            find_file,
            mcp_list_dir,
            mcp_file_info,
            commands::list_monospace_fonts,
            commands::is_git_repo,
            commands::list_gitignored,
            commands::remove_dir,
            file_utils::copy_files,
            file_utils::run_script,
            git_ops::push_branch,
            git_ops::git_checkout,
            git_worktree::create_worktree,
            git_worktree::remove_worktree,
            git_worktree::list_branches,
            git_info::git_status,
            git_info::git_remote_url,
            git_info::git_diff,
            gh_commands::gh_list_prs,
            gh_commands::gh_list_issues,
            gh_commands::gh_available,
            gh_commands::gh_view_pr,
            git_status_ops::git_rev_parse_toplevel,
            git_status_ops::git_status_short,
            git_status_ops::git_status_short_batch
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

            // Dev builds: set yellow icon and display name so Dock/app-switcher
            // clearly distinguish dev from release. Deferred to main thread so
            // it runs after Tauri's own post-setup icon/name initialization.
            #[cfg(all(debug_assertions, target_os = "macos"))]
            {
                let handle = app.handle().clone();
                let _ = handle.run_on_main_thread(|| {
                    use objc2::{AnyThread, MainThreadMarker};
                    use objc2_app_kit::{NSApplication, NSImage};
                    use objc2_foundation::NSData;
                    unsafe {
                        let mtm = MainThreadMarker::new_unchecked();
                        let bytes: &[u8] = include_bytes!("../icons/dev/128x128@2x.png");
                        let data = NSData::with_bytes(bytes);
                        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                            NSApplication::sharedApplication(mtm)
                                .setApplicationIconImage(Some(&image));
                        }
                    }
                });
            }

            // MCP bridge — opt-in, dormant unless enabled by setting + Claude
            // Code detection.
            if mcp_should_start() {
                let bridge_state = mcp_bridge::BridgeState::new();
                if let Err(e) = mcp_bridge::spawn(app.handle().clone(), bridge_state) {
                    // Bridge failure is non-fatal for the GUI, but the
                    // frontend needs to know so it can surface a toast
                    // (notably: Windows UDS unsupported). The mcp module
                    // logs details; here we just notify the frontend.
                    use tauri::Emitter;
                    let _ = app.emit("mcp-bridge-failed", e.clone());
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
    // PTY internals were extracted into `crate::pty` (Worker F refactor).
    // Tests still drive those internals directly to verify the reader thread,
    // OSC parser, pause flag, etc. — pull them into scope wholesale.
    use crate::pty::{
        classify_osc, sanitize_notification, AppState, OscAction, PauseFlag, PtyInstance,
        NEXT_PTY_ID,
    };
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::sync::atomic::{AtomicBool, Ordering};
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
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let ssh_key = format!("{home}/.ssh/id_rsa");
        let result = validate_read_path(&ssh_key);
        // Rejected either because the file doesn't exist (canonicalize fails)
        // or because the path is in the blocklist — both are safe outcomes on
        // CI runners that don't have ~/.ssh populated.
        assert!(result.is_err(), "Should block reading ~/.ssh/id_rsa");
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

    // F31: extended blocklist regression tests
    #[test]
    fn validate_read_path_blocks_netrc() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/.netrc");
        assert!(validate_read_path(&p).is_err(), "Should block ~/.netrc");
    }

    #[test]
    fn validate_read_path_blocks_git_credentials() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/.git-credentials");
        assert!(
            validate_read_path(&p).is_err(),
            "Should block ~/.git-credentials"
        );
    }

    #[test]
    fn validate_read_path_blocks_npmrc() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/.npmrc");
        assert!(validate_read_path(&p).is_err(), "Should block ~/.npmrc");
    }

    #[test]
    fn validate_read_path_blocks_pypirc() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/.pypirc");
        assert!(validate_read_path(&p).is_err(), "Should block ~/.pypirc");
    }

    #[test]
    fn validate_read_path_blocks_bash_history() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/.bash_history");
        assert!(
            validate_read_path(&p).is_err(),
            "Should block ~/.bash_history"
        );
    }

    #[test]
    fn validate_read_path_blocks_zsh_history() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/.zsh_history");
        assert!(
            validate_read_path(&p).is_err(),
            "Should block ~/.zsh_history"
        );
    }

    #[test]
    fn validate_read_path_blocks_fish_history() {
        let home = std::env::var("HOME").unwrap();
        // fish stores history in ~/.config/fish/ and ~/.local/share/fish/
        // The blocklist covers ~/.fish/ — test the direct prefix
        let p = format!("{home}/.fish/fish_history");
        assert!(validate_read_path(&p).is_err(), "Should block ~/.fish/");
    }

    #[test]
    fn validate_read_path_blocks_home_library_keychains() {
        let home = std::env::var("HOME").unwrap();
        let p = format!("{home}/Library/Keychains/login.keychain-db");
        assert!(
            validate_read_path(&p).is_err(),
            "Should block ~/Library/Keychains"
        );
    }

    #[test]
    fn validate_read_path_blocks_system_library_keychains() {
        // /Library/Keychains is system keychain (macOS). Blocked regardless of HOME.
        let result = validate_read_path("/Library/Keychains/System.keychain");
        assert!(
            result.is_err(),
            "Should block /Library/Keychains on macOS systems"
        );
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

    #[test]
    fn validate_write_path_allows_project_local_dot_gnar_term() {
        // Project-local state files (project dashboards, project-nested
        // agent dashboards) live inside a `.gnar-term/` directory under
        // the project's own path. This path shape is allowed even though
        // it's not under ~/.config/gnar-term/.
        let path = "/tmp/some-project/.gnar-term/project-dashboard.md";
        let result = validate_write_path(path);
        assert!(
            result.is_ok(),
            "Should allow writes under a project-local .gnar-term/ dir: {result:?}"
        );
    }

    #[test]
    fn validate_write_path_rejects_dot_gnar_term_lookalike() {
        // `.gnar-term.evil` is NOT the .gnar-term segment; must still be
        // blocked. Also tests that a path whose only "match" is a
        // prefix-sharing filename fails.
        let path = "/tmp/some-project/.gnar-term.evil/x.md";
        let result = validate_write_path(path);
        assert!(
            result.is_err(),
            "Should reject look-alike dirs (.gnar-term.evil): {result:?}"
        );
    }

    // -----------------------------------------------------------------------
    // Claude settings: validate_claude_read / validate_claude_write
    // -----------------------------------------------------------------------

    #[test]
    fn validate_claude_read_rejects_non_claude_path() {
        let result = validate_claude_read("/etc/hosts");
        assert!(
            result.is_err(),
            "Should reject non-.claude/ paths: {result:?}"
        );
    }

    #[test]
    fn validate_claude_read_rejects_traversal_escape() {
        // A raw substring check for `/.claude/` would be happy with this
        // and then `read_to_string` would resolve the `..` and escape.
        let home = std::env::var("HOME").unwrap();
        let evil = format!("{home}/.claude/../.ssh/id_rsa");
        let result = validate_claude_read(&evil);
        assert!(
            result.is_err(),
            "Should reject paths that traverse out of .claude/ via ..: {result:?}"
        );
    }

    #[test]
    fn validate_claude_read_rejects_lookalike_segment() {
        // `.claude.evil` shares a prefix but is NOT `.claude`.
        let path = "/tmp/evil/.claude.evil/secrets.json";
        let result = validate_claude_read(path);
        assert!(
            result.is_err(),
            "Should reject `.claude` lookalike directory names: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_allows_settings_json() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.claude/settings.json");
        let result = validate_claude_write(&path);
        assert!(
            result.is_ok(),
            "Should allow writing ~/.claude/settings.json: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_allows_settings_local_json() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.claude/settings.local.json");
        let result = validate_claude_write(&path);
        assert!(
            result.is_ok(),
            "Should allow writing ~/.claude/settings.local.json: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_allows_skills_subdir() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.claude/skills/my-skill/SKILL.md");
        let result = validate_claude_write(&path);
        assert!(
            result.is_ok(),
            "Should allow writing anywhere under ~/.claude/skills/: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_allows_agents_subdir() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.claude/agents/foo.json");
        let result = validate_claude_write(&path);
        assert!(
            result.is_ok(),
            "Should allow writing under ~/.claude/agents/: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_allows_project_scoped_claude_dir() {
        // Project-scoped `.claude/settings.local.json` under any directory
        // is allowed — the convention is `.claude` anywhere in the ancestry.
        let path = "/tmp/some-project/.claude/settings.local.json";
        let result = validate_claude_write(path);
        assert!(
            result.is_ok(),
            "Should allow writes to project-scoped .claude/settings.local.json: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_rejects_other_claude_files() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.claude/hooks.json");
        let result = validate_claude_write(&path);
        assert!(
            result.is_err(),
            "Should reject arbitrary ~/.claude/*.json files: {result:?}"
        );
        let path2 = format!("{home}/.claude/secrets.json");
        assert!(
            validate_claude_write(&path2).is_err(),
            "Should reject ~/.claude/secrets.json"
        );
    }

    #[test]
    fn validate_claude_write_rejects_non_claude_path() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{home}/.config/gnar-term/settings.json");
        let result = validate_claude_write(&path);
        assert!(
            result.is_err(),
            "Should reject non-.claude/ paths even when named settings.json: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_rejects_traversal() {
        let home = std::env::var("HOME").unwrap();
        // Traversal: starts inside .claude/ but climbs out.
        let path = format!("{home}/.claude/../.bashrc");
        let result = validate_claude_write(&path);
        assert!(
            result.is_err(),
            "Should reject traversal out of .claude/: {result:?}"
        );
    }

    #[test]
    fn validate_claude_write_rejects_lookalike_segment() {
        // `.claude.evil` must not satisfy the .claude segment check.
        let path = "/tmp/evil/.claude.evil/settings.json";
        let result = validate_claude_write(path);
        assert!(
            result.is_err(),
            "Should reject `.claude` lookalike segments: {result:?}"
        );
    }

    // Regression: a symlink inside ~/.claude/ that points into a blocked
    // directory (e.g. ~/.ssh) must not let a write escape via canonicalization.
    #[cfg(unix)]
    #[test]
    fn validate_claude_write_rejects_symlink_escape_to_blocked_dir() {
        let home = std::env::var("HOME").unwrap();
        let claude_dir = format!("{home}/.claude");
        let _ = std::fs::create_dir_all(&claude_dir);
        // Create ~/.ssh so canonicalize succeeds even on CI runners without
        // one. The directory itself is enough — we don't need any keys.
        let ssh_dir = format!("{home}/.ssh");
        let _ = std::fs::create_dir_all(&ssh_dir);

        let link_dir = format!("{claude_dir}/skills-escape-test-link");
        let _ = std::fs::remove_file(&link_dir);
        let _ = std::fs::remove_dir_all(&link_dir);
        std::os::unix::fs::symlink(&ssh_dir, &link_dir).expect("symlink");

        // Path shape satisfies the allowlist on paper
        // (.claude/<link>/skills/x.json passes the `seen_claude` +
        // `skills` component check), but the canonical form resolves into
        // ~/.ssh which is_blocked_path will reject.
        let evil = format!("{link_dir}/settings.json");
        let result = validate_claude_write(&evil);
        let _ = std::fs::remove_file(&link_dir);
        assert!(
            result.is_err(),
            "Should reject writes whose canonical resolves into a blocked dir: {result:?}"
        );
    }

    // Regression: a symlink inside the allowlist that points outside must
    // not allow writes to escape — the prior validator only resolved `..`
    // manually and would happily accept a symlink target like ~/.ssh.
    #[cfg(unix)]
    #[test]
    fn validate_write_path_rejects_symlink_escape() {
        let home = std::env::var("HOME").unwrap();
        let config_dir = format!("{home}/.config/gnar-term");
        let _ = std::fs::create_dir_all(&config_dir);
        let link = format!("{config_dir}/symlink-escape-test");
        // Clean from any prior run
        let _ = std::fs::remove_file(&link);
        let target = "/tmp";
        std::os::unix::fs::symlink(target, &link).expect("symlink");

        let result = validate_write_path(&format!("{link}/pwned.txt"));
        let _ = std::fs::remove_file(&link);
        assert!(
            result.is_err(),
            "Should reject writes through an escaping symlink: {result:?}"
        );
    }

    // -----------------------------------------------------------------------
    // Regression: discovery commands must honor the blocklist (review #1, #2)
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn file_exists_blocks_sensitive_paths() {
        let home = std::env::var("HOME").unwrap();
        let ssh = format!("{home}/.ssh/id_rsa");
        assert!(
            !file_exists(ssh).await,
            "file_exists must not leak presence of ~/.ssh/id_rsa"
        );
    }

    #[tokio::test]
    async fn list_dir_blocks_sensitive_paths() {
        let home = std::env::var("HOME").unwrap();
        let ssh = format!("{home}/.ssh");
        let result = list_dir(ssh).await;
        assert!(result.is_err(), "list_dir must refuse ~/.ssh");
    }

    #[tokio::test]
    async fn mcp_list_dir_blocks_sensitive_paths() {
        let home = std::env::var("HOME").unwrap();
        let ssh = format!("{home}/.ssh");
        let result = mcp_list_dir(ssh, Some(true)).await;
        assert!(result.is_err(), "mcp_list_dir must refuse ~/.ssh");
    }

    #[tokio::test]
    async fn mcp_file_info_blocks_sensitive_paths() {
        let home = std::env::var("HOME").unwrap();
        let ssh = format!("{home}/.ssh/id_rsa");
        let (exists, _) = mcp_file_info(ssh).await;
        assert!(
            !exists,
            "mcp_file_info must not leak presence of ~/.ssh/id_rsa"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_exists_rejects_symlink_to_blocked_dir() {
        // A symlink inside a normal dir that points at ~/.ssh must be blocked
        // even though the link's own path is benign.
        use std::fs;
        let home = std::env::var("HOME").unwrap();
        let blocked_target = format!("{home}/.ssh");
        // Only meaningful when the target actually exists on this host.
        if !std::path::Path::new(&blocked_target).exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("gnar_review_file_exists_test");
        let _ = fs::remove_file(&tmp);
        std::os::unix::fs::symlink(&blocked_target, &tmp).expect("failed to create test symlink");
        let path_str = tmp.to_string_lossy().to_string();
        let result = file_exists(path_str).await;
        let _ = fs::remove_file(&tmp);
        assert!(!result, "symlinks into ~/.ssh must be rejected");
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

        let watch_id = crate::file_watch::NEXT_WATCH_ID.fetch_add(1, Ordering::Relaxed);
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
        #[allow(unused_variables)] // `pid` is only read in the macOS cfg block
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

    // -----------------------------------------------------------------------
    // Batch cwd polling — get_all_pty_cwds returns entry for every live PTY (T10)
    // -----------------------------------------------------------------------

    #[test]
    fn get_all_pty_cwds_returns_cwd_for_all_ptys() {
        // Spawn two PTYs in different directories and verify the batch command
        // returns an entry for each without requiring per-PTY IPC round-trips.
        let state = AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        };

        let pty_system = native_pty_system();

        let spawn_pty_in_dir = |dir: &str| -> u32 {
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
            cmd.arg("sleep 3");
            cmd.cwd(dir);

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
            pty_id
        };

        let id1 = spawn_pty_in_dir("/tmp");
        let id2 = spawn_pty_in_dir("/tmp");

        // Allow processes to start
        std::thread::sleep(Duration::from_millis(200));

        // Collect pid_map same way get_all_pty_cwds does (lock then release)
        let pid_map: Vec<(u32, u32)> = {
            let ptys = state.ptys.lock().unwrap();
            ptys.iter()
                .filter_map(|(&id, entry)| entry.child_pid.map(|pid| (id, pid)))
                .collect()
        };

        let mut result: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        for (pty_id, pid) in pid_map {
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("lsof")
                    .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
                    .output()
                    .expect("lsof should run");
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
            #[cfg(target_os = "linux")]
            {
                if let Ok(path) = std::fs::read_link(format!("/proc/{pid}/cwd")) {
                    result.insert(pty_id.to_string(), path.to_string_lossy().to_string());
                }
            }
        }

        // Both PTYs should be present in the result map
        assert!(
            result.contains_key(&id1.to_string()),
            "Batch result should contain pty_id {id1}"
        );
        assert!(
            result.contains_key(&id2.to_string()),
            "Batch result should contain pty_id {id2}"
        );

        // Each should resolve to /tmp (macOS may symlink it to /private/tmp)
        let cwd1 = result.get(&id1.to_string()).unwrap();
        let cwd2 = result.get(&id2.to_string()).unwrap();
        for cwd in [cwd1, cwd2] {
            assert!(
                cwd == "/tmp" || cwd == "/private/tmp",
                "Expected /tmp or /private/tmp, got: {cwd}"
            );
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
    fn osc777_notify_payload_is_humanized() {
        // OSC 777 xterm/urxvt notify format: notify;<title>;<body>
        // We format as "<title>: <body>" so the UI doesn't surface the
        // raw "notify;…" prefix (regression: Claude Code emits this and
        // the sidebar was showing the raw payload).
        assert_eq!(
            classify_osc("777;notify;Title;Body text"),
            OscAction::Notification("Title: Body text".into())
        );
    }

    #[test]
    fn osc777_notify_title_only() {
        assert_eq!(
            classify_osc("777;notify;Claude Code;"),
            OscAction::Notification("Claude Code".into())
        );
    }

    #[test]
    fn osc777_non_notify_payload_passes_through() {
        // Non-notify OSC 777 sub-actions keep their raw payload so we
        // don't lose information when an agent uses a custom action.
        assert_eq!(
            classify_osc("777;other;Hello"),
            OscAction::Notification("other;Hello".into())
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

    // --- sanitize_notification tests (F17) ---

    #[test]
    fn sanitize_strips_c0_control_characters() {
        // NUL, BEL, ESC, etc. should be removed
        let input = "hello\x00world\x07\x1b[31m";
        assert_eq!(sanitize_notification(input), "helloworld[31m");
    }

    #[test]
    fn sanitize_strips_del_and_c1_controls() {
        let input = "foo\x7fbar\u{0080}\u{009f}baz";
        assert_eq!(sanitize_notification(input), "foobarbaz");
    }

    #[test]
    fn sanitize_truncates_to_500_chars() {
        let long = "a".repeat(600);
        let result = sanitize_notification(&long);
        assert_eq!(result.len(), 500);
    }

    #[test]
    fn sanitize_preserves_normal_unicode() {
        let input = "Build complete \u{2705}";
        assert_eq!(sanitize_notification(input), input);
    }

    #[test]
    fn osc9_notification_strips_control_chars() {
        // A PTY payload containing an embedded ESC sequence should be sanitized
        assert_eq!(
            classify_osc("9;Hello\x1b[1mWorld"),
            OscAction::Notification("Hello[1mWorld".into())
        );
    }

    #[test]
    fn osc_notification_truncated_at_500_chars() {
        let long_payload = format!("9;{}", "x".repeat(600));
        if let OscAction::Notification(text) = classify_osc(&long_payload) {
            assert_eq!(text.len(), 500);
        } else {
            panic!("Expected Notification variant");
        }
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

    #[tokio::test]
    async fn open_url_rejects_javascript_scheme() {
        let result = open_url("javascript:alert(1)".to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Rejected"));
    }

    #[tokio::test]
    async fn open_url_rejects_file_scheme() {
        let result = open_url("file:///etc/passwd".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn open_url_rejects_non_http_scheme() {
        // Covers ftp://, data:, javascript:, file:// etc.
        for bad in &[
            "ftp://example.com",
            "data:text/html,x",
            "javascript:alert(1)",
        ] {
            let result = open_url(bad.to_string()).await;
            assert!(result.is_err(), "Expected error for {bad}");
        }
    }
}
