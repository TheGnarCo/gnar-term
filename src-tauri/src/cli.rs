use clap::Parser;
use serde::Serialize;

/// CLI arguments for GnarTerm.
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

/// Flags accepted by CliArgs that take a value argument.
const VALUE_FLAGS: &[&str] = &[
    "-d", "--working-directory",
    "-e", "--command",
    "--title",
    "-w", "--workspace",
    "-c", "--config",
];

/// Flags accepted by CliArgs that are standalone (no value).
const STANDALONE_FLAGS: &[&str] = &["-h", "--help", "-V", "--version"];

/// Filter argv to only args defined by CliArgs, dropping unknown flags
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
                if !next.starts_with('-') && !next.starts_with('/')
                    && !next.starts_with('~') && !next.starts_with('.')
                {
                    args.next(); // consume the value too
                }
            }
        }
    }

    result
}

pub(crate) fn expand_path(path: &str) -> String {
    let expanded = if path.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{}/{}", home, &path[2..])
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

    // -----------------------------------------------------------------------
    // filter_known_args tests
    // -----------------------------------------------------------------------

    fn args(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn filter_keeps_positional_path() {
        let input = args(&["gnar-term", "/home/user"]);
        assert_eq!(filter_known_args(input.into_iter()), args(&["gnar-term", "/home/user"]));
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
        let input = args(&["gnar-term", "--color", "--no-default-features", "/home/user"]);
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
            "gnar-term", "--color", "-w", "dev", "--no-default-features",
            "-e", "bash", "--unknown", "~/Documents",
        ]);
        assert_eq!(
            filter_known_args(input.into_iter()),
            args(&["gnar-term", "-w", "dev", "-e", "bash", "~/Documents"])
        );
    }
}
