use clap::Parser;
use serde::Serialize;

/// CLI arguments for `GnarTerm`.
#[derive(Parser, Debug, Clone, Default, Serialize)]
#[command(name = "gnar-term", version, about = "Terminal workspace manager")]
pub(crate) struct CliArgs {
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
pub(crate) fn filter_known_args(args: impl Iterator<Item = String>) -> Vec<String> {
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

pub(crate) fn expand_path(path: &str) -> String {
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

pub(crate) fn resolve_cli_paths(mut args: CliArgs) -> CliArgs {
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
pub(crate) fn get_cli_args(args: tauri::State<'_, CliArgs>) -> CliArgs {
    args.inner().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn filter_empty_args_returns_empty() {
        let input: Vec<String> = vec![];
        assert_eq!(filter_known_args(input.into_iter()), Vec::<String>::new());
    }

    #[test]
    fn filter_binary_name_only() {
        let input = args(&["gnar-term"]);
        assert_eq!(filter_known_args(input.into_iter()), args(&["gnar-term"]));
    }

    #[test]
    fn filter_bare_dash_is_positional() {
        // A bare "-" (stdin marker) should be treated as positional
        let input = args(&["gnar-term", "-"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "-"])
        );
    }

    #[test]
    fn filter_keeps_help_flag() {
        let input = args(&["gnar-term", "-h"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "-h"])
        );
    }

    #[test]
    fn filter_keeps_version_flag() {
        let input = args(&["gnar-term", "--version"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "--version"])
        );
    }

    #[test]
    fn filter_unknown_flag_followed_by_path_keeps_path() {
        let input = args(&["gnar-term", "--unknown", "/home/user"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "/home/user"])
        );
    }

    #[test]
    fn filter_unknown_flag_followed_by_tilde_path_keeps_path() {
        let input = args(&["gnar-term", "--unknown", "~/projects"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "~/projects"])
        );
    }

    #[test]
    fn filter_unknown_flag_followed_by_dot_path_keeps_path() {
        let input = args(&["gnar-term", "--unknown", "./src"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "./src"])
        );
    }

    #[test]
    fn filter_double_dash_stops_flag_processing() {
        let input = args(&["gnar-term", "--", "--color", "-e", "test"]);
        assert_eq!(filter_known_args(input.clone().into_iter()), input);
    }

    #[test]
    fn filter_known_value_flag_missing_value() {
        let input = args(&["gnar-term", "-d"]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "-d"])
        );
    }

    // -----------------------------------------------------------------------
    // expand_path tests
    // -----------------------------------------------------------------------

    #[test]
    fn expand_path_absolute_path_unchanged() {
        let result = expand_path("/tmp");
        assert!(
            result == "/tmp" || result == "/private/tmp",
            "Should resolve /tmp, got: {result}"
        );
    }

    #[test]
    fn expand_path_tilde_expands_home() {
        let home = std::env::var("HOME").expect("HOME should be set");
        let result = expand_path("~/");
        assert!(
            result.contains(&home) || std::path::Path::new(&result).is_dir(),
            "~/  should expand to home dir, got: {result}"
        );
    }

    #[test]
    fn expand_path_nonexistent_returns_expanded_string() {
        let result = expand_path("~/nonexistent_dir_abc123xyz");
        let home = std::env::var("HOME").expect("HOME should be set");
        assert_eq!(
            result,
            format!("{home}/nonexistent_dir_abc123xyz"),
            "Should return tilde-expanded path when canonicalize fails"
        );
    }

    #[test]
    fn expand_path_relative_nonexistent() {
        let result = expand_path("nonexistent_relative_path_xyz");
        assert_eq!(result, "nonexistent_relative_path_xyz");
    }

    // -----------------------------------------------------------------------
    // resolve_cli_paths tests
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_cli_paths_expands_tilde_in_path() {
        let home = std::env::var("HOME").expect("HOME should be set");
        let cli = CliArgs {
            path: Some("~/test_dir_that_does_not_exist".into()),
            ..Default::default()
        };
        let resolved = resolve_cli_paths(cli);
        assert_eq!(
            resolved.path.unwrap(),
            format!("{home}/test_dir_that_does_not_exist")
        );
    }

    #[test]
    fn resolve_cli_paths_expands_working_directory() {
        let home = std::env::var("HOME").expect("HOME should be set");
        let cli = CliArgs {
            working_directory: Some("~/wd_test_nonexistent".into()),
            ..Default::default()
        };
        let resolved = resolve_cli_paths(cli);
        assert_eq!(
            resolved.working_directory.unwrap(),
            format!("{home}/wd_test_nonexistent")
        );
    }

    #[test]
    fn resolve_cli_paths_expands_config() {
        let home = std::env::var("HOME").expect("HOME should be set");
        let cli = CliArgs {
            config: Some("~/config_test_nonexistent.toml".into()),
            ..Default::default()
        };
        let resolved = resolve_cli_paths(cli);
        assert_eq!(
            resolved.config.unwrap(),
            format!("{home}/config_test_nonexistent.toml")
        );
    }

    #[test]
    fn resolve_cli_paths_leaves_none_fields_unchanged() {
        let cli = CliArgs::default();
        let resolved = resolve_cli_paths(cli);
        assert!(resolved.path.is_none());
        assert!(resolved.working_directory.is_none());
        assert!(resolved.config.is_none());
        assert!(resolved.command.is_none());
        assert!(resolved.title.is_none());
        assert!(resolved.workspace.is_none());
    }

    #[test]
    fn resolve_cli_paths_does_not_touch_command_or_title() {
        let cli = CliArgs {
            command: Some("echo hello".into()),
            title: Some("My Title".into()),
            ..Default::default()
        };
        let resolved = resolve_cli_paths(cli);
        assert_eq!(resolved.command.unwrap(), "echo hello");
        assert_eq!(resolved.title.unwrap(), "My Title");
    }
}
