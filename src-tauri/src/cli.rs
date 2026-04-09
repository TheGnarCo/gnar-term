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
/// that leak from Cargo/Tauri during `tauri dev`.
pub fn filter_known_args(args: impl Iterator<Item = String>) -> Vec<String> {
    let mut result = Vec::new();
    let mut args = args.peekable();

    if let Some(bin) = args.next() {
        result.push(bin);
    }

    while let Some(arg) = args.next() {
        if !arg.starts_with('-') || arg == "-" {
            result.push(arg);
        } else if arg == "--" {
            result.push(arg);
            result.extend(args);
            break;
        } else if arg.contains('=') {
            let flag = arg.split('=').next().unwrap_or("");
            if VALUE_FLAGS.contains(&flag) {
                result.push(arg);
            }
        } else if VALUE_FLAGS.contains(&arg.as_str()) {
            result.push(arg);
            if let Some(val) = args.next() {
                result.push(val);
            }
        } else if STANDALONE_FLAGS.contains(&arg.as_str()) {
            result.push(arg);
        } else if arg.starts_with("-psn_") {
            // macOS Finder process serial number — drop.
        } else {
            // Unknown flag — drop it, and also its value if next arg isn't a flag.
            if let Some(next) = args.peek() {
                if !next.starts_with('-') {
                    args.next();
                }
            }
        }
    }
    result
}

fn expand_path(path: &str) -> String {
    if path.starts_with('~') {
        if let Ok(home) = std::env::var("HOME") {
            return path.replacen('~', &home, 1);
        }
    }
    path.to_string()
}

pub fn resolve_cli_paths(mut args: CliArgs) -> CliArgs {
    if let Some(ref p) = args.path {
        let expanded = expand_path(p);
        let abs = std::path::Path::new(&expanded)
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from(&expanded));
        args.path = Some(abs.to_string_lossy().to_string());
    }
    if let Some(ref p) = args.working_directory {
        let expanded = expand_path(p);
        let abs = std::path::Path::new(&expanded)
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from(&expanded));
        args.working_directory = Some(abs.to_string_lossy().to_string());
    }
    args
}

/// Return CLI arguments passed to the app.
#[tauri::command]
pub fn get_cli_args(args: tauri::State<'_, CliArgs>) -> CliArgs {
    args.inner().clone()
}
