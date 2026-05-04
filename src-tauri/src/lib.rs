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
// file_utils.rs, file_watch.rs) via the historical `crate::validate_*`
// paths. `global_config_dir` is used directly in `run()` below.
pub(crate) use fs_commands::{
    global_config_dir, validate_claude_read, validate_read_path, validate_write_path,
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

    // F31: extended blocklist regression tests
    // -----------------------------------------------------------------------
    // Claude settings: validate_claude_read / validate_claude_write
    // -----------------------------------------------------------------------

    // Regression: a symlink inside ~/.claude/ that points into a blocked
    // directory (e.g. ~/.ssh) must not let a write escape via canonicalization.
    // Regression: a symlink inside the allowlist that points outside must
    // not allow writes to escape — the prior validator only resolved `..`
    // manually and would happily accept a symlink target like ~/.ssh.
    // -----------------------------------------------------------------------
    // Regression: discovery commands must honor the blocklist (review #1, #2)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Bug fix: OSC 7 CWD parsing (B2)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Bug fix: PID cast safety (B1)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // PTY spawn and output (T1)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // PTY write and read output (T1b)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // PTY resize (T2)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // PTY kill / removal from map (T3)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // File read/write roundtrip (T4)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // File watcher with cancellation (T5)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Base64 encoding (T6)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Ensure dir (T7)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Home directory (T8)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // PTY spawns in specified cwd and get_pty_cwd returns it (T9)
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // Batch cwd polling — get_all_pty_cwds returns entry for every live PTY (T10)
    // -----------------------------------------------------------------------

    // --- OSC classifier tests (issue #20) ---

    // --- sanitize_notification tests (F17) ---

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
