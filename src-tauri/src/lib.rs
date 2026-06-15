use clap::Parser;
use std::collections::HashMap;
use std::sync::Mutex;

pub mod mcp_bridge;
pub mod mcp_register;

mod cli;
mod filesystem;
mod mcp_settings;
mod osc;
mod path_security;
mod pty;
mod state;

use cli::{filter_known_args, get_cli_args, resolve_cli_paths, CliArgs};
use filesystem::*;
use mcp_settings::mcp_should_start;
use path_security::file_exists;
use pty::*;
use state::AppState;

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
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        })
        .manage(cli_args)
        .invoke_handler(tauri::generate_handler![
            get_cli_args, spawn_pty, write_pty, resize_pty, kill_pty, pause_pty, resume_pty, detect_font, get_pty_cwd, get_pty_pid, get_pty_title, file_exists, list_dir, read_file, read_file_base64, write_file, ensure_dir, get_home, watch_file, unwatch_file, show_in_file_manager, open_with_default_app, find_file, mcp_list_dir, mcp_file_info
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

                // Edit Menu — Copy/Cut/Paste/Select All are PredefinedMenuItems
                // which enable native clipboard in the WebView for non-terminal
                // content (preview surfaces, command palette, etc.).
                // Terminal surfaces override Cmd+C/V via attachCustomKeyEventHandler.
                let cut = PredefinedMenuItem::cut(handle, None)?;
                let copy = PredefinedMenuItem::copy(handle, None)?;
                // Custom Paste (not PredefinedMenuItem::paste): the predefined
                // item fires the native NSText paste, which bypasses xterm.js's
                // bracketed-paste wrapping (\x1b[200~…\x1b[201~). TUIs like
                // Claude Code rely on that wrapping to treat a multiline paste
                // as one block; without it they submit on the first newline.
                // We emit `menu-paste` and let the frontend route it by focus.
                let paste = MenuItem::with_id(handle, "menu-paste", "Paste", true, Some("CmdOrCtrl+V"))?;
                let select_all = PredefinedMenuItem::select_all(handle, None)?;

                let edit_menu = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[&cut, &copy, &paste, &select_all],
                )?;

                let cmd_palette = MenuItem::with_id(handle, "cmd-palette", "Command Palette...", true, Some("CmdOrCtrl+P"))?;
                let close_tab = MenuItem::with_id(handle, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;

                // View > Theme submenu
                use tauri::menu::MenuItem;
                let theme_github = MenuItem::with_id(handle, "theme-github-dark", "GitHub Dark", true, None::<&str>)?;
                let theme_tokyo = MenuItem::with_id(handle, "theme-tokyo-night", "Tokyo Night", true, None::<&str>)?;
                let theme_catppuccin = MenuItem::with_id(handle, "theme-catppuccin-mocha", "Catppuccin Mocha", true, None::<&str>)?;
                let theme_dracula = MenuItem::with_id(handle, "theme-dracula", "Dracula", true, None::<&str>)?;
                let theme_solarized = MenuItem::with_id(handle, "theme-solarized-dark", "Solarized Dark", true, None::<&str>)?;
                let theme_onedark = MenuItem::with_id(handle, "theme-one-dark", "One Dark", true, None::<&str>)?;

                let theme_sep = PredefinedMenuItem::separator(handle)?;
                let theme_molly = MenuItem::with_id(handle, "theme-molly", "Molly", true, None::<&str>)?;
                let theme_molly_disco = MenuItem::with_id(handle, "theme-molly-disco", "Molly Disco", true, None::<&str>)?;
                let theme_github_light = MenuItem::with_id(handle, "theme-github-light", "GitHub Light", true, None::<&str>)?;
                let theme_solarized_light = MenuItem::with_id(handle, "theme-solarized-light", "Solarized Light", true, None::<&str>)?;
                let theme_catppuccin_latte = MenuItem::with_id(handle, "theme-catppuccin-latte", "Catppuccin Latte", true, None::<&str>)?;

                let theme_submenu = Submenu::with_items(
                    handle,
                    "Theme",
                    true,
                    &[&theme_github, &theme_tokyo, &theme_catppuccin, &theme_dracula, &theme_solarized, &theme_onedark,
                      &theme_sep, &theme_molly, &theme_molly_disco, &theme_github_light, &theme_solarized_light, &theme_catppuccin_latte],
                )?;

                let view_menu = Submenu::with_items(
                    handle,
                    "View",
                    true,
                    &[&cmd_palette, &close_tab, &PredefinedMenuItem::separator(handle)?, &theme_submenu],
                )?;

                let menu = Menu::with_items(handle, &[&app_menu, &edit_menu, &view_menu])?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let id = event.id().as_ref();
            if id.starts_with("theme-") {
                let _ = app.emit("menu-theme", id.to_string());
            } else if id == "cmd-palette" {
                let _ = app.emit("menu-cmd-palette", ());
            } else if id == "close-tab" {
                let _ = app.emit("menu-close-tab", ());
            } else if id == "menu-paste" {
                let _ = app.emit("menu-paste", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GnarTerm");
}
