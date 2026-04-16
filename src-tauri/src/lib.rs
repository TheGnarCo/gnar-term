mod cli;
mod commands;
mod file_utils;
mod gh_commands;
mod git_info;
mod git_ops;
mod git_worktree;
pub mod mcp_bridge;
pub mod mcp_register;
mod osc_parser;
mod pty;

use pty::PtyInstance;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::{Arc, Mutex};

pub(crate) static NEXT_PTY_ID: AtomicU32 = AtomicU32::new(1);
pub(crate) static NEXT_WATCH_ID: AtomicU32 = AtomicU32::new(1);

pub(crate) struct AppState {
    pub(crate) ptys: Mutex<HashMap<u32, PtyInstance>>,
    pub(crate) watch_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

/// Get the user's home directory (cross-platform)
pub(crate) fn home_dir() -> Result<String, String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "HOME/USERPROFILE not set".to_string())
}

/// Block reads to sensitive directories (SSH keys, credentials, etc.)
pub(crate) fn validate_read_path(path: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Invalid path {path}: {e}"))?;
    let path_str = canonical.to_string_lossy();

    if let Ok(home) = home_dir() {
        let blocked = [
            "/.ssh",
            "/.gnupg",
            "/.aws",
            "/.kube",
            "/.config/gcloud",
            "/.docker",
            "/.netrc",
            "/.config/gh",
            "/Library/Keychains",
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

/// Validate that a write path is under ~/.config/gnar-term/
pub(crate) fn validate_write_path(path: &str) -> Result<(), String> {
    let home = home_dir()?;
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

    // Defense against symlink escapes: if the resolved path (or its closest
    // existing ancestor) canonicalizes outside the allowed prefix, reject it.
    let mut check = norm_path.clone();
    loop {
        if check.exists() {
            match std::fs::canonicalize(&check) {
                Ok(canonical) => {
                    let canon_allowed = std::fs::canonicalize(&norm_allowed)
                        .unwrap_or_else(|_| norm_allowed.clone());
                    if !canonical.starts_with(&canon_allowed) {
                        return Err(format!("Write denied: path resolves outside {allowed}"));
                    }
                    break;
                }
                Err(_) => break, // can't canonicalize, manual check above is sufficient
            }
        }
        if !check.pop() {
            break;
        }
    }

    Ok(())
}

pub(crate) fn b64_encode(data: &[u8]) -> String {
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

/// Read the `mcp` key from ~/.config/gnar-term/gnar-term.json. Values:
/// "on" / "off" / "auto" (default).
fn read_mcp_setting() -> String {
    if let Ok(home) = home_dir() {
        let p = format!("{home}/.config/gnar-term/gnar-term.json");
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
    use clap::Parser;
    use tauri::Emitter;

    // Handle --mcp-stdio BEFORE touching Tauri — this mode is a pure byte
    // pipe and never launches the GUI.
    let raw_args: Vec<String> = std::env::args().collect();
    if raw_args.iter().any(|a| a == "--mcp-stdio") {
        std::process::exit(mcp_bridge::run_stdio_shim());
    }

    // Parse CLI args. Use whitelist filter to drop unknown flags that leak
    // from Cargo/Tauri during `tauri dev` (--color, --no-default-features, etc.).
    let filtered_args = cli::filter_known_args(std::env::args());
    let cli_args = cli::resolve_cli_paths(cli::CliArgs::parse_from(filtered_args));

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        })
        .manage(cli_args)
        .invoke_handler(tauri::generate_handler![
            cli::get_cli_args,
            pty::spawn_pty,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            pty::pause_pty,
            pty::resume_pty,
            commands::detect_font,
            commands::list_monospace_fonts,
            pty::get_pty_cwd,
            pty::get_pty_title,
            commands::file_exists,
            commands::list_dir,
            commands::is_git_repo,
            commands::list_gitignored,
            commands::read_file,
            commands::read_file_base64,
            commands::write_file,
            commands::ensure_dir,
            commands::remove_dir,
            commands::get_home,
            commands::watch_file,
            commands::unwatch_file,
            commands::show_in_file_manager,
            commands::open_with_default_app,
            commands::find_file,
            // Phase 2: Git & file utility commands
            git_worktree::create_worktree,
            git_worktree::remove_worktree,
            git_worktree::list_worktrees,
            git_worktree::list_branches,
            git_ops::git_clone,
            git_ops::push_branch,
            git_ops::delete_branch,
            git_ops::git_checkout,
            file_utils::copy_files,
            file_utils::run_script,
            gh_commands::gh_list_issues,
            gh_commands::gh_list_prs,
            git_info::git_log,
            git_info::git_status,
            git_info::git_diff,
            git_info::git_merge,
            // MCP bridge commands
            pty::get_pty_pid,
            commands::mcp_list_dir,
            commands::mcp_file_info
        ])
        .setup(|app| {
            // Write shell integration files once at startup (static content)
            if let Ok(home) = home_dir() {
                let integration_dir = format!("{home}/.config/gnar-term/shell");
                let _ = std::fs::create_dir_all(&integration_dir);

                let zshenv = r#"# GnarTerm shell integration
[ -f "$GNARTERM_ORIG_ZDOTDIR/.zshenv" ] && source "$GNARTERM_ORIG_ZDOTDIR/.zshenv"
export ZDOTDIR="$GNARTERM_ORIG_ZDOTDIR"
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
precmd_functions+=(_gnarterm_report_cwd)
chpwd_functions+=(_gnarterm_report_cwd)
"#;
                let _ = std::fs::write(format!("{integration_dir}/.zshenv"), zshenv);

                let bash_content = r#"# GnarTerm bash integration
_gnarterm_report_cwd() { printf '\e]7;file://%s%s\a' "$(hostname)" "$PWD"; }
PROMPT_COMMAND="_gnarterm_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
"#;
                let _ = std::fs::write(
                    format!("{home}/.config/gnar-term/shell/bash-integration.sh"),
                    bash_content,
                );
            }

            // Set window title from CLI --title flag
            {
                use tauri::Manager;
                let cli = app.state::<cli::CliArgs>();
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
                if mcp_bridge::spawn(app.handle().clone(), bridge_state).is_ok() {
                    if let Ok(exe) = std::env::current_exe() {
                        let exe_str = exe.to_string_lossy().to_string();
                        std::thread::spawn(move || {
                            mcp_register::register_if_needed(&exe_str);
                        });
                    }
                }
            }

            // Rebuild macOS menu manually so Cmd+Q, Cmd+C, Cmd+V work,
            // but Cmd+T/Cmd+W/Cmd+N are passed down to JS.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
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
        let ssh_dir = format!("{home}/.ssh");
        let result = validate_read_path(&ssh_dir);
        // Either blocked by "Access denied" or path doesn't exist — both acceptable
        assert!(result.is_err(), "Should block reading ~/.ssh");
    }

    #[test]
    fn validate_read_path_blocks_gnupg_dir() {
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let gpg = format!("{home}/.gnupg/trustdb.gpg");
        let result = validate_read_path(&gpg);
        // Rejected either because dir doesn't exist (canonicalize fails)
        // or because it's in the blocklist — both are safe outcomes
        assert!(result.is_err(), "Should block reading ~/.gnupg/");
    }

    #[test]
    fn validate_read_path_blocks_aws_credentials() {
        let home = std::env::var("HOME").expect("HOME env var required for tests");
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
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let config = format!("{home}/.config/gnar-term/settings.json");
        let result = validate_write_path(&config);
        assert!(
            result.is_ok(),
            "Should allow writing to ~/.config/gnar-term/: {result:?}"
        );
    }

    #[test]
    fn validate_write_path_blocks_home_dir() {
        let home = std::env::var("HOME").expect("HOME env var required for tests");
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
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let traversal = format!("{home}/.config/gnar-term/../../.bashrc");
        let result = validate_write_path(&traversal);
        assert!(result.is_err(), "Should block path traversal via ../");
    }

    #[test]
    fn validate_write_path_allows_nested_config() {
        let home = std::env::var("HOME").expect("HOME env var required for tests");
        let nested = format!("{home}/.config/gnar-term/themes/custom.json");
        let result = validate_write_path(&nested);
        assert!(
            result.is_ok(),
            "Should allow nested paths under config dir: {result:?}"
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

    #[test]
    fn b64_encode_all_zero_bytes() {
        // 3 zero bytes -> "AAAA"
        assert_eq!(b64_encode(&[0, 0, 0]), "AAAA");
    }

    #[test]
    fn b64_encode_padding_one_byte_remainder() {
        // 4 bytes: 3 encode cleanly + 1 remainder -> 8 chars with "==" padding
        let encoded = b64_encode(b"test");
        assert_eq!(encoded, "dGVzdA==");
        assert!(encoded.ends_with("=="));
    }

    #[test]
    fn b64_encode_padding_two_byte_remainder() {
        // 5 bytes: 3 encode cleanly + 2 remainder -> 8 chars with "=" padding
        let encoded = b64_encode(b"tests");
        assert_eq!(encoded, "dGVzdHM=");
        assert!(encoded.ends_with('='));
        assert!(!encoded.ends_with("=="));
    }

    #[test]
    fn b64_encode_no_padding_exact_multiple() {
        // 6 bytes: exactly 2 chunks of 3 -> 8 chars, no padding
        let encoded = b64_encode(b"abcdef");
        assert_eq!(encoded, "YWJjZGVm");
        assert!(!encoded.contains('='));
    }

    #[test]
    fn b64_encode_large_payload() {
        // 4096 bytes — verify length is correct and no panic
        let data: Vec<u8> = (0..4096).map(|i| (i % 256) as u8).collect();
        let encoded = b64_encode(&data);
        // base64 output length = ceil(n/3) * 4
        let expected_len = data.len().div_ceil(3) * 4;
        assert_eq!(encoded.len(), expected_len);
    }

    #[test]
    fn b64_encode_only_high_bytes() {
        let data: Vec<u8> = vec![0xFF, 0xFE, 0xFD];
        let encoded = b64_encode(&data);
        assert_eq!(encoded, "//79");
    }
}
