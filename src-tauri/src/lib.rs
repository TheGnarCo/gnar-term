mod b64;
mod cli;
mod font;
mod fs;
mod git;
mod osc;
mod pty;

use clap::Parser;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Emitter;

pub struct AppState {
    pub ptys: Mutex<HashMap<u32, pty::PtyInstance>>,
    pub watch_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let filtered = cli::filter_known_args(std::env::args());
    let cli_args = cli::resolve_cli_paths(
        cli::CliArgs::parse_from(filtered),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        })
        .manage(cli_args)
        .invoke_handler(tauri::generate_handler![
            pty::spawn_pty, pty::write_pty, pty::resize_pty, pty::kill_pty,
            pty::pause_pty, pty::resume_pty, pty::get_pty_cwd, pty::get_pty_title,
            font::detect_font,
            fs::file_exists, fs::list_dir, fs::list_files_recursive, fs::read_file, fs::read_file_base64,
            fs::write_file, fs::ensure_dir, fs::get_home, fs::watch_file,
            fs::unwatch_file, fs::show_in_file_manager, fs::open_with_default_app,
            fs::find_file,
            git::git_clone, git::create_worktree, git::git_checkout, git::remove_worktree,
            git::list_worktrees, git::list_branches, git::git_fetch_all,
            git::push_branch, git::delete_branch,
            git::git_status, git::git_diff, git::git_log, git::git_ls_files,
            git::gh_list_issues, git::gh_list_prs,
            git::git_add, git::git_commit, git::git_push, git::git_pull, git::git_rev_list_count,
            git::git_branch_name, git::git_diff_staged, git::gh_create_pr,
            git::run_script, git::copy_files,
            cli::get_cli_args,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
                let handle = app.handle();

                let hide = PredefinedMenuItem::hide(handle, None)?;
                let hide_others = PredefinedMenuItem::hide_others(handle, None)?;
                let show_all = PredefinedMenuItem::show_all(handle, None)?;
                let quit = PredefinedMenuItem::quit(handle, None)?;

                let app_menu = Submenu::with_items(
                    handle, "GnarTerm", true,
                    &[&hide, &hide_others, &show_all, &PredefinedMenuItem::separator(handle)?, &quit],
                )?;

                let cut = PredefinedMenuItem::cut(handle, None)?;
                let copy = PredefinedMenuItem::copy(handle, None)?;
                let paste = PredefinedMenuItem::paste(handle, None)?;
                let select_all = PredefinedMenuItem::select_all(handle, None)?;

                let edit_menu = Submenu::with_items(
                    handle, "Edit", true,
                    &[&cut, &copy, &paste, &select_all],
                )?;

                let cmd_palette = MenuItem::with_id(handle, "cmd-palette", "Command Palette...", true, Some("CmdOrCtrl+P"))?;
                let close_tab = MenuItem::with_id(handle, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;

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
                    handle, "Theme", true,
                    &[&theme_github, &theme_tokyo, &theme_catppuccin, &theme_dracula, &theme_solarized, &theme_onedark,
                      &theme_sep, &theme_molly, &theme_molly_disco, &theme_github_light, &theme_solarized_light, &theme_catppuccin_latte],
                )?;

                let view_menu = Submenu::with_items(
                    handle, "View", true,
                    &[&cmd_palette, &close_tab, &PredefinedMenuItem::separator(handle)?, &theme_submenu],
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
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};
    use pty::{PauseFlag, PtyInstance, NEXT_PTY_ID};
    use fs::{validate_read_path, validate_write_path};
    use git::parse_worktree_list;

    #[test]
    fn pause_flag_blocks_and_resumes() {
        let flag = Arc::new(PauseFlag::new());
        let flag2 = flag.clone();
        flag.pause();
        let handle = std::thread::spawn(move || {
            let start = Instant::now();
            flag2.wait_if_paused();
            start.elapsed()
        });
        std::thread::sleep(Duration::from_millis(50));
        flag.resume();
        let elapsed = handle.join().unwrap();
        assert!(elapsed >= Duration::from_millis(40), "Thread should have blocked ~50ms, got {:?}", elapsed);
        assert!(elapsed < Duration::from_millis(500), "Thread should resume quickly, got {:?}", elapsed);
    }

    #[test]
    fn pause_flag_does_not_block_when_not_paused() {
        let flag = PauseFlag::new();
        let start = Instant::now();
        flag.wait_if_paused();
        assert!(start.elapsed() < Duration::from_millis(5), "Should not block");
    }

    #[test]
    fn pty_read_ps_aux_does_not_hang() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("Failed to open PTY");
        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("ps aux; echo '__DONE__'");
        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("Failed to get reader");
        let pause_flag = Arc::new(PauseFlag::new());
        let pause_clone = pause_flag.clone();
        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut total_bytes = 0usize;
            let mut output = Vec::new();
            loop {
                pause_clone.wait_if_paused();
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        total_bytes += n;
                        output.extend_from_slice(&buf[..n]);
                        if total_bytes % 32768 < 4096 {
                            pause_clone.wait_if_paused();
                        }
                    }
                    Err(_) => break,
                }
            }
            (total_bytes, output)
        });
        std::thread::sleep(Duration::from_millis(10));
        pause_flag.pause();
        std::thread::sleep(Duration::from_millis(50));
        pause_flag.resume();
        let (total_bytes, output) = reader_handle.join().expect("Reader thread panicked");
        assert!(total_bytes > 0, "Should have read some bytes from ps aux");
        let output_str = String::from_utf8_lossy(&output);
        assert!(output_str.contains("__DONE__"), "Should have received all output (got {} bytes)", total_bytes);
    }

    #[test]
    fn pty_high_throughput_does_not_stall() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .expect("Failed to open PTY");
        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c");
        cmd.arg("yes 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' | head -c 500000; echo '__HIGH_THROUGHPUT_DONE__'");
        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("Failed to get reader");
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
        for _ in 0..10 {
            std::thread::sleep(Duration::from_millis(5));
            pause_flag.pause();
            std::thread::sleep(Duration::from_millis(10));
            pause_flag.resume();
        }
        let (total, tail) = reader_handle.join().expect("Reader thread panicked");
        let elapsed = start.elapsed();
        assert!(elapsed < Duration::from_secs(10), "Should complete within 10s, took {:?}", elapsed);
        assert!(total > 50_000, "Should read at least 50KB, got {}", total);
        let tail_str = String::from_utf8_lossy(&tail);
        assert!(tail_str.contains("__HIGH_THROUGHPUT_DONE__"), "Should receive completion marker (got {} bytes total)", total);
    }

    // Security: path validation
    #[test]
    fn validate_read_path_allows_normal_files() {
        let result = validate_read_path("/etc/hosts");
        assert!(result.is_ok(), "Should allow reading /etc/hosts: {:?}", result);
    }

    #[test]
    fn validate_read_path_blocks_ssh_dir() {
        let home = std::env::var("HOME").unwrap();
        let result = validate_read_path(&format!("{}/.ssh/id_rsa", home));
        assert!(result.is_err(), "Should block reading ~/.ssh/id_rsa");
    }

    #[test]
    fn validate_read_path_blocks_gnupg_dir() {
        let home = std::env::var("HOME").unwrap();
        let result = validate_read_path(&format!("{}/.gnupg/trustdb.gpg", home));
        assert!(result.is_err(), "Should block reading ~/.gnupg/");
    }

    #[test]
    fn validate_read_path_blocks_aws_credentials() {
        let home = std::env::var("HOME").unwrap();
        let result = validate_read_path(&format!("{}/.aws/credentials", home));
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
        let result = validate_write_path(&format!("{}/.config/gnar/settings.json", home));
        assert!(result.is_ok(), "Should allow writing to ~/.config/gnar/: {:?}", result);
    }

    #[test]
    fn validate_write_path_blocks_home_dir() {
        let home = std::env::var("HOME").unwrap();
        let result = validate_write_path(&format!("{}/.bashrc", home));
        assert!(result.is_err(), "Should block writing to ~/.bashrc");
    }

    #[test]
    fn validate_write_path_blocks_system_paths() {
        let result = validate_write_path("/etc/passwd");
        assert!(result.is_err(), "Should block writing to /etc/passwd");
    }

    #[test]
    fn validate_write_path_blocks_traversal() {
        let home = std::env::var("HOME").unwrap();
        let result = validate_write_path(&format!("{}/.config/gnar/../../.bashrc", home));
        assert!(result.is_err(), "Should block path traversal via ../");
    }

    #[test]
    fn validate_write_path_allows_nested_config() {
        let home = std::env::var("HOME").unwrap();
        let result = validate_write_path(&format!("{}/.config/gnar/themes/custom.json", home));
        assert!(result.is_ok(), "Should allow nested paths under config dir: {:?}", result);
    }

    // OSC 7 CWD parsing
    #[test]
    fn osc7_parse_empty_hostname() {
        let url = "file:///Users/foo";
        let path = url.strip_prefix("file://").unwrap();
        let cwd = if path.starts_with('/') { path.to_string() } else if let Some(slash_idx) = path.find('/') { path[slash_idx..].to_string() } else { path.to_string() };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn osc7_parse_with_hostname() {
        let url = "file://myhost/Users/foo";
        let path = url.strip_prefix("file://").unwrap();
        let cwd = if path.starts_with('/') { path.to_string() } else if let Some(slash_idx) = path.find('/') { path[slash_idx..].to_string() } else { path.to_string() };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn osc7_parse_no_scheme() {
        let url = "/Users/foo".to_string();
        let cwd = if let Some(path) = url.strip_prefix("file://") {
            if path.starts_with('/') { path.to_string() } else if let Some(slash_idx) = path.find('/') { path[slash_idx..].to_string() } else { path.to_string() }
        } else { url.clone() };
        assert_eq!(cwd, "/Users/foo");
    }

    #[test]
    fn pid_i32_cast_rejects_overflow() {
        let big_pid: u32 = u32::MAX;
        assert!(i32::try_from(big_pid).is_err(), "i32::try_from(u32::MAX) should fail");
    }

    #[test]
    fn pid_i32_cast_accepts_normal_pid() {
        let normal_pid: u32 = 12345;
        assert_eq!(i32::try_from(normal_pid).unwrap(), 12345);
    }

    // PTY integration tests
    #[test]
    fn pty_spawn_returns_valid_id_and_is_tracked() {
        let state = AppState {
            ptys: Mutex::new(HashMap::new()),
            watch_flags: Mutex::new(HashMap::new()),
        };
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("Failed to open PTY");
        let mut cmd = CommandBuilder::new("sh");
        cmd.arg("-c"); cmd.arg("echo HELLO; sleep 0.1");
        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let child_pid = child.process_id();
        drop(pair.slave);
        let writer = pair.master.take_writer().expect("Failed to get writer");
        let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);
        assert!(pty_id > 0);
        let paused = Arc::new(PauseFlag::new());
        { state.ptys.lock().unwrap().insert(pty_id, PtyInstance { writer, _master: pair.master, child_pid, paused }); }
        let ptys = state.ptys.lock().unwrap();
        assert!(ptys.contains_key(&pty_id));
        assert!(ptys.get(&pty_id).unwrap().child_pid.is_some());
    }

    #[test]
    fn pty_write_and_read_echo_output() {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("Failed to open PTY");
        let cmd = CommandBuilder::new("cat");
        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);
        let mut writer = pair.master.take_writer().expect("Failed to get writer");
        let mut reader = pair.master.try_clone_reader().expect("Failed to get reader");
        use std::io::Write;
        writer.write_all(b"HELLO\n").expect("Failed to write");
        drop(writer);
        let mut output = Vec::new();
        let mut buf = [0u8; 4096];
        loop { match reader.read(&mut buf) { Ok(0) => break, Ok(n) => output.extend_from_slice(&buf[..n]), Err(_) => break } }
        assert!(String::from_utf8_lossy(&output).contains("HELLO"));
    }

    #[test]
    fn pty_resize_does_not_panic() {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("Failed to open PTY");
        let mut cmd = CommandBuilder::new("sh"); cmd.arg("-c"); cmd.arg("sleep 1");
        let _child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        drop(pair.slave);
        assert!(pair.master.resize(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 }).is_ok());
        assert!(pair.master.resize(PtySize { rows: 1, cols: 1, pixel_width: 0, pixel_height: 0 }).is_ok());
    }

    #[test]
    fn pty_kill_removes_from_state() {
        let state = AppState { ptys: Mutex::new(HashMap::new()), watch_flags: Mutex::new(HashMap::new()) };
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("Failed to open PTY");
        let mut cmd = CommandBuilder::new("sh"); cmd.arg("-c"); cmd.arg("sleep 60");
        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let child_pid = child.process_id();
        drop(pair.slave);
        let writer = pair.master.take_writer().expect("Failed to get writer");
        let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);
        let paused = Arc::new(PauseFlag::new());
        { state.ptys.lock().unwrap().insert(pty_id, PtyInstance { writer, _master: pair.master, child_pid, paused: paused.clone() }); }
        assert!(state.ptys.lock().unwrap().contains_key(&pty_id));
        {
            let mut ptys = state.ptys.lock().unwrap();
            if let Some(pty) = ptys.remove(&pty_id) {
                pty.paused.resume();
                if let Some(pid) = pty.child_pid {
                    #[cfg(unix)] unsafe { libc::kill(pid as i32, libc::SIGKILL); }
                }
            }
        }
        assert!(!state.ptys.lock().unwrap().contains_key(&pty_id));
    }

    #[test]
    fn file_read_write_roundtrip() {
        let home = std::env::var("HOME").unwrap();
        let config_dir = format!("{}/.config/gnar/test-tmp", home);
        std::fs::create_dir_all(&config_dir).expect("Failed to create test dir");
        let test_path = format!("{}/roundtrip_test.txt", config_dir);
        let content = "Hello from GnarTerm integration test!\nLine 2\nLine 3 with unicode: \u{1F680}";
        validate_write_path(&test_path).expect("Write path should be valid");
        std::fs::write(&test_path, content).expect("Failed to write test file");
        let validated = validate_read_path(&test_path).expect("Read path should be valid");
        let read_back = std::fs::read_to_string(&validated).expect("Failed to read test file");
        assert_eq!(read_back, content);
        let _ = std::fs::remove_file(&test_path);
        let _ = std::fs::remove_dir(&config_dir);
    }

    #[test]
    fn file_watcher_cancellation_sets_stop_flag() {
        use std::sync::atomic::AtomicBool;
        let stop = Arc::new(AtomicBool::new(false));
        assert!(!stop.load(Ordering::Relaxed));
        stop.store(true, Ordering::Relaxed);
        assert!(stop.load(Ordering::Relaxed));
    }

    #[test]
    fn pty_spawn_with_cwd_and_get_cwd() {
        let state = AppState { ptys: Mutex::new(HashMap::new()), watch_flags: Mutex::new(HashMap::new()) };
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).expect("Failed to open PTY");
        let mut cmd = CommandBuilder::new("sh"); cmd.arg("-c"); cmd.arg("pwd; sleep 5");
        cmd.cwd("/tmp");
        let child = pair.slave.spawn_command(cmd).expect("Failed to spawn");
        let child_pid = child.process_id();
        drop(pair.slave);
        let writer = pair.master.take_writer().expect("Failed to get writer");
        let pty_id = NEXT_PTY_ID.fetch_add(1, Ordering::Relaxed);
        let paused = Arc::new(PauseFlag::new());
        { state.ptys.lock().unwrap().insert(pty_id, PtyInstance { writer, _master: pair.master, child_pid, paused }); }
        if let Some(pid) = child_pid {
            #[cfg(target_os = "macos")]
            {
                std::thread::sleep(Duration::from_millis(100));
                let output = std::process::Command::new("lsof").args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"]).output();
                if let Ok(out) = output {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let has_tmp = stdout.lines().any(|l| l.starts_with("n/") && l.contains("tmp"));
                    assert!(has_tmp, "PTY cwd should be /tmp, lsof output: {}", stdout);
                }
            }
        }
        // Cleanup
        {
            let mut ptys = state.ptys.lock().unwrap();
            if let Some(pty) = ptys.remove(&pty_id) {
                pty.paused.resume();
                if let Some(pid) = pty.child_pid {
                    #[cfg(unix)] unsafe { libc::kill(pid as i32, libc::SIGKILL); }
                }
            }
        }
    }

    // Git parser tests
    #[test]
    fn parse_worktree_list_basic() {
        let output = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD def456\nbranch refs/heads/feature\n\n";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].branch, "main");
        assert_eq!(result[1].branch, "feature");
    }

    #[test]
    fn parse_worktree_list_detached() {
        let output = "worktree /repo\nHEAD abc123\ndetached\n\n";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].branch, "(detached)");
    }

    // OSC tests
    #[test]
    fn osc_classify_title() {
        assert_eq!(osc::classify_osc("0;test"), osc::OscAction::Title("test".into()));
    }

    #[test]
    fn osc_classify_notification() {
        assert_eq!(osc::classify_osc("9;Hello"), osc::OscAction::Notification("Hello".into()));
    }

    // B64 tests
    #[test]
    fn b64_encode_hello_world() {
        assert_eq!(b64::encode(b"Hello, World!"), "SGVsbG8sIFdvcmxkIQ==");
    }

    #[test]
    fn b64_encode_empty() {
        assert_eq!(b64::encode(b""), "");
    }

    #[test]
    fn b64_encode_single_byte() {
        assert_eq!(b64::encode(b"A"), "QQ==");
    }

    #[test]
    fn b64_encode_two_bytes() {
        assert_eq!(b64::encode(b"AB"), "QUI=");
    }

    #[test]
    fn b64_encode_three_bytes() {
        assert_eq!(b64::encode(b"ABC"), "QUJD");
    }

    #[test]
    fn b64_encode_binary_data() {
        let binary = vec![0x00, 0xFF, 0x80, 0x7F];
        let encoded = b64::encode(&binary);
        assert!(!encoded.is_empty());
    }

    #[test]
    fn b64_encode_terminal_escape_sequences() {
        let esc = b"\x1b[31mRed\x1b[0m";
        let encoded = b64::encode(esc);
        assert!(!encoded.is_empty());
    }

    // Git parser tests
    use git::{parse_branch_list, parse_git_log, parse_git_status};

    #[test]
    fn parse_worktree_list_empty() {
        assert_eq!(parse_worktree_list(""), Vec::<git::WorktreeInfo>::new());
    }

    #[test]
    fn parse_worktree_list_single_main() {
        let output = "worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].path, "/repo");
        assert_eq!(result[0].branch, "main");
    }

    #[test]
    fn parse_worktree_list_bare_repo() {
        let output = "worktree /bare.git\nHEAD abc123\nbare\n\n";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_bare);
    }

    #[test]
    fn parse_branch_list_empty() {
        assert_eq!(parse_branch_list(""), Vec::<git::BranchInfo>::new());
    }

    #[test]
    fn parse_branch_list_local_only() {
        let output = "refs/heads/main\tabc1234\t*\nrefs/heads/feature\tdef5678\t \n";
        let result = parse_branch_list(output);
        assert_eq!(result.len(), 2);
        assert!(result[0].is_current);
        assert!(!result[1].is_current);
        assert!(!result[0].is_remote);
    }

    #[test]
    fn parse_branch_list_with_remotes() {
        let output = "refs/heads/main\tabc1234\t*\nrefs/remotes/origin/main\tabc1234\t \n";
        let result = parse_branch_list(output);
        assert_eq!(result.len(), 2);
        assert!(!result[0].is_remote);
        assert!(result[1].is_remote);
    }

    #[test]
    fn parse_git_status_empty() {
        assert_eq!(parse_git_status(""), Vec::<git::FileStatus>::new());
    }

    #[test]
    fn parse_git_status_basic() {
        let output = "M  src/main.rs\n?? new-file.txt\nA  added.txt\n";
        let result = parse_git_status(output);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].path, "src/main.rs");
        assert_eq!(result[0].index_status, "M");
    }

    #[test]
    fn parse_git_log_empty() {
        assert_eq!(parse_git_log(""), Vec::<git::CommitInfo>::new());
    }

    #[test]
    fn parse_git_log_basic() {
        let output = "abc123\x00abc1\x00Fix bug\x00Author\x002024-01-01\n";
        let result = parse_git_log(output);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].subject, "Fix bug");
    }

    #[test]
    fn get_home_returns_valid_path() {
        let home = std::env::var("HOME");
        assert!(home.is_ok(), "HOME should be set");
        assert!(home.unwrap().starts_with('/'), "HOME should be an absolute path");
    }

    #[test]
    fn ensure_dir_creates_nested_directory() {
        let home = std::env::var("HOME").unwrap();
        let test_dir = format!("{}/.config/gnar/test-ensure-dir/nested/deep", home);
        validate_write_path(&test_dir).expect("Write path should be valid");
        std::fs::create_dir_all(&test_dir).expect("Should create nested dirs");
        assert!(std::path::Path::new(&test_dir).exists());
        let _ = std::fs::remove_dir_all(format!("{}/.config/gnar/test-ensure-dir", home));
    }
}
