//! Filesystem commands and path-validation helpers.
//!
//! All read/write commands invoked from the frontend land here. The
//! validation helpers (`validate_read_path`, `validate_write_path`,
//! `validate_claude_read`, `validate_claude_write`) enforce the
//! sensitive-path blocklist and the gnar-term write allowlist (state under
//! `~/.config/gnar-term/`, project-local state under any `.gnar-term/`
//! directory, and a narrow set of paths under `.claude/`).

use serde::Serialize;

/// String-prefix check for known-sensitive directories.
///
/// Does NOT resolve symlinks — callers that need symlink-safety should also
/// pass the canonicalized path through this check (see `validate_read_path`).
fn is_blocked_path(path_str: &str) -> bool {
    if let Ok(home) = std::env::var("HOME") {
        let blocked = [
            "/.ssh",
            "/.gnupg",
            "/.aws",
            "/.kube",
            "/.config/gcloud",
            "/.docker",
            // F31: additional sensitive credential/history locations
            "/.netrc",
            "/.git-credentials",
            "/.npmrc",
            "/.pypirc",
            "/.bash_history",
            "/.zsh_history",
            "/.fish/",
            // macOS keychain directory
            "/Library/Keychains",
        ];
        for prefix in blocked {
            if path_str.starts_with(&format!("{home}{prefix}")) {
                return true;
            }
        }
    }
    path_str.starts_with("/etc/shadow")
        || path_str.starts_with("/etc/gshadow")
        // System keychains (macOS)
        || path_str.starts_with("/Library/Keychains")
        || path_str.starts_with("/System/Library/Keychains")
}

/// Block reads to sensitive directories (SSH keys, credentials, etc.)
pub(crate) fn validate_read_path(path: &str) -> Result<std::path::PathBuf, String> {
    // Catch unresolved paths that are literal hits (e.g. non-existent
    // /Users/u/.ssh/id_rsa should fail closed even if canonicalize succeeds).
    if is_blocked_path(path) {
        return Err(format!("Access denied: {path}"));
    }
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Invalid path {path}: {e}"))?;
    if is_blocked_path(&canonical.to_string_lossy()) {
        return Err(format!("Access denied: {path}"));
    }
    Ok(canonical)
}

/// Check if a file exists (lightweight — no read). Blocked paths report as
/// non-existent to avoid leaking presence of files like `~/.ssh/id_rsa`.
#[tauri::command]
pub(crate) async fn file_exists(path: String) -> bool {
    if is_blocked_path(&path) {
        return false;
    }
    match std::fs::canonicalize(&path) {
        Ok(canonical) => !is_blocked_path(&canonical.to_string_lossy()),
        Err(_) => false,
    }
}

/// List filenames in a directory (non-recursive, files only)
#[tauri::command]
pub(crate) async fn list_dir(path: String) -> Result<Vec<String>, String> {
    let validated = validate_read_path(&path)?;
    let entries =
        std::fs::read_dir(&validated).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
    let mut names = Vec::new();
    for entry in entries.flatten() {
        if let Ok(ft) = entry.file_type() {
            if ft.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_string());
                }
            }
        }
    }
    Ok(names)
}

/// Read a file's contents
#[tauri::command]
pub(crate) async fn read_file(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    std::fs::read_to_string(&validated).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Directory entry metadata for the MCP `list_dir` tool.
#[derive(Clone, Serialize)]
pub(crate) struct McpDirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

/// List a directory as a vector of entries with type + size metadata.
/// Unlike `list_dir` (which returns only file names) this returns directories
/// and files so the CWD File Navigator can render a tree.
#[tauri::command]
pub(crate) async fn mcp_list_dir(
    path: String,
    include_hidden: Option<bool>,
) -> Result<Vec<McpDirEntry>, String> {
    let validated = validate_read_path(&path)?;
    let include_hidden = include_hidden.unwrap_or(false);
    let entries =
        std::fs::read_dir(&validated).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let entry_path = entry.path().to_string_lossy().to_string();
        out.push(McpDirEntry {
            name,
            path: entry_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    // Stable ordering: directories first, then files, alphabetic within.
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(out)
}

/// Return `(exists, is_dir)` for the MCP `file_exists` tool. Blocked paths
/// report as non-existent (see `file_exists`).
#[tauri::command]
pub(crate) async fn mcp_file_info(path: String) -> (bool, bool) {
    if is_blocked_path(&path) {
        return (false, false);
    }
    match std::fs::canonicalize(&path) {
        Ok(canonical) => {
            if is_blocked_path(&canonical.to_string_lossy()) {
                return (false, false);
            }
            match std::fs::metadata(&canonical) {
                Ok(m) => (true, m.is_dir()),
                Err(_) => (false, false),
            }
        }
        Err(_) => (false, false),
    }
}

/// Read a file as base64 (for binary files like images)
#[tauri::command]
pub(crate) async fn read_file_base64(path: String) -> Result<String, String> {
    let validated = validate_read_path(&path)?;
    let bytes = std::fs::read(&validated).map_err(|e| format!("Failed to read {path}: {e}"))?;
    Ok(b64_encode(&bytes))
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

/// Validate that a write path is within gnar-term's allowlist:
///   - under `~/.config/gnar-term/` (global state), OR
///   - under any `.gnar-term/` directory (project-local state — projects
///     and project-nested dashboards persist their markdown there so
///     multi-machine sync / checkout follows the project itself).
pub(crate) fn validate_write_path(path: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    // Allow both prod and dev config dirs so that the validation is not
    // build-mode-dependent (tests always run in debug mode).
    let global_allowed = format!("{home}/.config/gnar-term");
    let global_allowed_dev = format!("{home}/.config/gnar-term-dev");

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
    let norm_global_allowed = std::path::Path::new(&global_allowed)
        .components()
        .collect::<std::path::PathBuf>();
    let norm_global_allowed_dev = std::path::Path::new(&global_allowed_dev)
        .components()
        .collect::<std::path::PathBuf>();

    // Does the normalized path contain a `.gnar-term` directory segment
    // anywhere in its ancestry? If so it's a project-local state file.
    let has_gnar_term_segment = norm_path
        .components()
        .any(|c| matches!(c, std::path::Component::Normal(s) if s == ".gnar-term"));
    let under_global_allowed = norm_path.starts_with(&norm_global_allowed)
        || norm_path.starts_with(&norm_global_allowed_dev);

    if !under_global_allowed && !has_gnar_term_segment {
        return Err(format!(
            "Write denied: path must be under {global_allowed} or inside a .gnar-term/ directory"
        ));
    }

    // Walk the deepest existing ancestor through canonicalize so a symlink
    // inside the allowlist that points outside (e.g. ~/.config/gnar-term/x
    // → ~/.ssh) cannot be used as a write target. If no ancestor exists
    // yet, there's nothing to escape through.
    let mut probe = norm_path.as_path();
    while !probe.exists() {
        match probe.parent() {
            Some(p) => probe = p,
            None => return Ok(()),
        }
    }
    let canonical = std::fs::canonicalize(probe)
        .map_err(|e| format!("Failed to canonicalize {}: {e}", probe.display()))?;
    if under_global_allowed {
        let canonical_prod =
            std::fs::canonicalize(&norm_global_allowed).unwrap_or(norm_global_allowed);
        let canonical_dev =
            std::fs::canonicalize(&norm_global_allowed_dev).unwrap_or(norm_global_allowed_dev);
        if !canonical.starts_with(&canonical_prod) && !canonical.starts_with(&canonical_dev) {
            return Err(format!("Write denied: path must be under {global_allowed}"));
        }
        return Ok(());
    }
    // project-local state: the declared path had a `.gnar-term` segment
    // and we need to verify no symlink in its ancestry escapes out. If
    // the deepest existing ancestor is ABOVE the `.gnar-term` segment,
    // the `.gnar-term` directory doesn't exist yet — there's nothing for
    // a symlink to redirect. Safe.
    let probe_has_gnar_term = probe
        .components()
        .any(|c| matches!(c, std::path::Component::Normal(s) if s == ".gnar-term"));
    if !probe_has_gnar_term {
        return Ok(());
    }
    // `.gnar-term` exists somewhere in the ancestor chain. Verify its
    // canonical still contains that segment (catches a
    // `.gnar-term` → `~/.ssh` symlink that would resolve past the intent).
    let canonical_has_gnar_term = canonical
        .components()
        .any(|c| matches!(c, std::path::Component::Normal(s) if s == ".gnar-term"));
    if !canonical_has_gnar_term {
        return Err("Write denied: resolved path escapes the .gnar-term/ allowlist".to_string());
    }
    Ok(())
}

/// Write content to a file
#[tauri::command]
pub(crate) async fn write_file(path: String, content: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Expand a leading `~/` into `$HOME/`. Does not touch paths that don't begin with `~/`.
fn expand_home(path: &str) -> std::path::PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_default();
        std::path::PathBuf::from(home).join(rest)
    } else {
        std::path::PathBuf::from(path)
    }
}

/// Normalize `..`/`.` components in a path without touching the filesystem.
/// Matches the traversal-defense used by `validate_write_path`.
fn normalize_components(path: &std::path::Path) -> std::path::PathBuf {
    let mut resolved = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                resolved.pop();
            }
            std::path::Component::CurDir => {}
            c => resolved.push(c),
        }
    }
    resolved.into_iter().collect()
}

/// Does this normalized path have a literal `.claude` directory segment?
/// Guards against lookalikes such as `.claude.evil`.
fn has_claude_segment(path: &std::path::Path) -> bool {
    path.components()
        .any(|c| matches!(c, std::path::Component::Normal(s) if s == ".claude"))
}

/// Validate that a path resolves to somewhere inside a `.claude/` directory
/// and doesn't escape via `..` or symlinks. Used for read/list/watch commands
/// on Claude settings files, which the global blocklist would otherwise allow
/// but which we want to scope to the settings surface only.
pub(crate) fn validate_claude_read(path: &str) -> Result<std::path::PathBuf, String> {
    let resolved = expand_home(path);
    let normalized = normalize_components(&resolved);
    if !has_claude_segment(&normalized) {
        return Err(format!(
            "Read denied: path must be under a .claude/ directory: {path}"
        ));
    }
    // Canonicalize (if the file exists) so symlinks are followed to their
    // real target, then reject only if the target is a sensitive system
    // directory. A `~/.claude` that symlinks into a dotfiles repo is a
    // legitimate setup, so `.claude` is not required to survive
    // canonicalization.
    let canonical =
        std::fs::canonicalize(&normalized).map_err(|e| format!("Invalid path {path}: {e}"))?;
    if is_blocked_path(&canonical.to_string_lossy()) {
        return Err(format!(
            "Read denied: resolved path escapes to a blocked directory: {path}"
        ));
    }
    Ok(canonical)
}

/// Validate that a write target is inside a `.claude/` directory AND is one
/// of the files/subdirs we explicitly allow writing to (settings.json,
/// settings.local.json, or anything under skills/ or agents/). Handles paths
/// whose target file does not yet exist by canonicalizing the deepest existing
/// ancestor, matching the pattern used by `validate_write_path`.
pub(crate) fn validate_claude_write(path: &str) -> Result<std::path::PathBuf, String> {
    let resolved = expand_home(path);
    let normalized = normalize_components(&resolved);
    if !has_claude_segment(&normalized) {
        return Err(format!(
            "Write denied: path must be under a .claude/ directory: {path}"
        ));
    }

    // Determine whether the target is one of the allowed settings files
    // (`settings.json` / `settings.local.json`) or sits inside an allowed
    // subdirectory (`skills/` or `agents/`) that itself is inside `.claude/`.
    let filename = normalized
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("");

    // Walk the components once, tracking whether we've seen `.claude` yet;
    // an `agents` or `skills` segment that appears AFTER `.claude` is allowed.
    let mut seen_claude = false;
    let mut under_allowed_subdir = false;
    for component in normalized.components() {
        if let std::path::Component::Normal(s) = component {
            if seen_claude && (s == "skills" || s == "agents") {
                under_allowed_subdir = true;
                break;
            }
            if s == ".claude" {
                seen_claude = true;
            }
        }
    }

    let allowed_filename = filename == "settings.json" || filename == "settings.local.json";
    if !allowed_filename && !under_allowed_subdir {
        return Err(format!(
            "Write denied: only settings.json, settings.local.json, skills/, and agents/ are writable under .claude/: {path}"
        ));
    }

    // Symlink-escape defense: canonicalize the deepest existing ancestor
    // and ensure it doesn't resolve into a sensitive system directory.
    // We deliberately do NOT require `.claude` to survive canonicalization —
    // dotfile setups commonly symlink `~/.claude` (or `settings.json` inside
    // it) into e.g. `~/dotFiles/dot-claude/` which is legitimate. The risk
    // we're guarding against is a link that escapes to `~/.ssh`, `/etc`, etc.
    let mut probe = normalized.as_path();
    while !probe.exists() {
        match probe.parent() {
            Some(p) => probe = p,
            None => return Ok(normalized),
        }
    }
    let canonical = std::fs::canonicalize(probe)
        .map_err(|e| format!("Failed to canonicalize {}: {e}", probe.display()))?;
    if is_blocked_path(&canonical.to_string_lossy()) {
        return Err(format!(
            "Write denied: resolved path escapes to a blocked directory: {path}"
        ));
    }
    Ok(normalized)
}

/// Read a Claude settings file. Separate from `read_file` so the frontend
/// can access `~/.claude/` paths — `validate_read_path` blocks nothing inside
/// `.claude/` today, but this dedicated command pairs with `write_claude_file`
/// for symmetry and lets us tighten the policy independently if needed.
#[tauri::command]
pub(crate) async fn read_claude_file(path: String) -> Result<String, String> {
    let resolved = validate_claude_read(&path)?;
    std::fs::read_to_string(&resolved).map_err(|e| format!("Failed to read {path}: {e}"))
}

/// Write a Claude settings file. The general `write_file` command refuses
/// paths outside `~/.config/gnar-term/` and `.gnar-term/`; this command
/// opens up writes to the narrow set of Claude settings paths we edit.
#[tauri::command]
pub(crate) async fn write_claude_file(path: String, content: String) -> Result<(), String> {
    let resolved = validate_claude_write(&path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
    }
    std::fs::write(&resolved, content).map_err(|e| format!("Failed to write {path}: {e}"))
}

/// Directory entry returned by `list_claude_dir`.
#[derive(Clone, Serialize)]
pub(crate) struct ClaudeDirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// List the entries (files and subdirectories) inside a `.claude/` directory.
#[tauri::command]
pub(crate) async fn list_claude_dir(path: String) -> Result<Vec<ClaudeDirEntry>, String> {
    let resolved = validate_claude_read(&path)?;
    let entries =
        std::fs::read_dir(&resolved).map_err(|e| format!("Failed to read dir {path}: {e}"))?;
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let entry_path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        result.push(ClaudeDirEntry {
            name,
            path: entry_path,
            is_dir,
        });
    }
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    Ok(result)
}

/// Ensure a directory exists
#[tauri::command]
pub(crate) async fn ensure_dir(path: String) -> Result<(), String> {
    validate_write_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create dir {path}: {e}"))
}

/// Get the user's home directory
#[tauri::command]
pub(crate) async fn get_home() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "HOME not set".to_string())
}

/// Returns the global config directory, isolated per build type.
/// Debug builds use `~/.config/gnar-term-dev` so the dev Tauri window
/// does not share state with the production build.
pub(crate) fn global_config_dir() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    #[cfg(debug_assertions)]
    {
        Ok(format!("{home}/.config/gnar-term-dev"))
    }
    #[cfg(not(debug_assertions))]
    {
        Ok(format!("{home}/.config/gnar-term"))
    }
}

#[tauri::command]
pub(crate) async fn get_global_config_dir() -> Result<String, String> {
    global_config_dir()
}

#[tauri::command]
pub(crate) fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

/// Show a file in the system file manager
#[tauri::command]
pub(crate) async fn show_in_file_manager(path: String) -> Result<(), String> {
    let validated = validate_read_path(&path)?;
    let validated_str = validated.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &validated_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let dir = validated
            .parent()
            .map_or(validated_str, |p| p.to_string_lossy().to_string());
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open a file with the default system app
#[tauri::command]
pub(crate) async fn open_with_default_app(path: String) -> Result<(), String> {
    let validated = validate_read_path(&path)?;
    let validated_str = validated.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&validated_str)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&validated_str)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a URL in the system default browser
#[tauri::command]
pub(crate) async fn open_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(format!("Rejected non-http URL scheme: {}", parsed.scheme()));
    }
    let url = parsed.to_string();
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Find a file by name using platform-specific search
#[tauri::command]
pub(crate) async fn find_file(name: String) -> Result<String, String> {
    // Reject path separators and leading hyphens to prevent flag injection in
    // mdfind/locate/find and prevent path traversal disguised as a filename.
    if name.is_empty() || name.starts_with('-') || name.contains('/') || name.contains('\\') {
        return Err(
            "Invalid file name: must not be empty, start with '-', or contain path separators"
                .to_string(),
        );
    }
    // macOS: use Spotlight (mdfind) — fast indexed search
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("mdfind")
            .args(["-name", &name])
            .output()
            .map_err(|e| format!("mdfind failed: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.starts_with('/') && line.ends_with(&name) && validate_read_path(line).is_ok() {
                return Ok(line.to_string());
            }
        }
    }
    // Linux: use locate (if available) then fall back to find in home
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("locate")
            .args(["-l", "10", "-b", &name])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with('/') && validate_read_path(line).is_ok() {
                    return Ok(line.to_string());
                }
            }
        }
        // Fall back to find in home directory
        let home = std::env::var("HOME").unwrap_or_default();
        if let Ok(output) = std::process::Command::new("find")
            .args([&home, "-maxdepth", "4", "-name", &name, "-print"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with('/') && validate_read_path(line).is_ok() {
                    return Ok(line.to_string());
                }
            }
        }
    }
    Err(format!("File not found: {name}"))
}

/// Detect the user's terminal font by reading existing terminal configs
#[tauri::command]
pub(crate) async fn detect_font() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();

    // 1. Ghostty config
    let ghostty_path = format!("{home}/.config/ghostty/config");
    if let Ok(content) = std::fs::read_to_string(&ghostty_path) {
        for line in content.lines() {
            let line = line.trim();
            if line.starts_with("font-family") {
                if let Some(val) = line.split('=').nth(1) {
                    let font = val.trim().to_string();
                    if !font.is_empty() {
                        return Ok(font);
                    }
                }
            }
        }
    }

    // 2. Alacritty config (TOML)
    for path in [
        format!("{home}/.config/alacritty/alacritty.toml"),
        format!("{home}/.alacritty.toml"),
    ] {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let mut in_font = false;
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("[font") {
                    in_font = true;
                } else if trimmed.starts_with('[') {
                    in_font = false;
                }
                if in_font && trimmed.starts_with("family") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        let font = val.trim().trim_matches('"').trim_matches('\'').to_string();
                        if !font.is_empty() {
                            return Ok(font);
                        }
                    }
                }
            }
        }
    }

    // 3. Kitty config
    let kitty_path = format!("{home}/.config/kitty/kitty.conf");
    if let Ok(content) = std::fs::read_to_string(&kitty_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("font_family") && !trimmed.starts_with('#') {
                let font = trimmed
                    .strip_prefix("font_family")
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !font.is_empty() {
                    return Ok(font);
                }
            }
        }
    }

    // 4. WezTerm config (Lua — best effort)
    let wez_path = format!("{home}/.wezterm.lua");
    if let Ok(content) = std::fs::read_to_string(&wez_path) {
        for line in content.lines() {
            if line.contains("font_family") || line.contains("font =") {
                // Extract quoted string
                if let Some(start) = line.find('"') {
                    if let Some(end) = line[start + 1..].find('"') {
                        let font = line[start + 1..start + 1 + end].to_string();
                        if !font.is_empty() {
                            return Ok(font);
                        }
                    }
                }
            }
        }
    }

    // 5. iTerm2 (macOS) — read from defaults
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("defaults")
            .args(["read", "com.googlecode.iterm2", "New Bookmarks"])
            .output();
        if let Ok(o) = output {
            let text = String::from_utf8_lossy(&o.stdout);
            // Look for "Normal Font" = "<FontName> <Size>";
            for line in text.lines() {
                if line.contains("Normal Font") {
                    if let Some(start) = line.find('"') {
                        let rest = &line[start + 1..];
                        if let Some(start2) = rest.find('"') {
                            let rest2 = &rest[start2 + 1..];
                            if let Some(end) = rest2.find('"') {
                                let font_spec = &rest2[..end];
                                // Format is "FontName Size" — strip the size
                                let font = font_spec
                                    .rsplitn(2, ' ')
                                    .last()
                                    .unwrap_or(font_spec)
                                    .to_string();
                                if !font.is_empty() {
                                    return Ok(font);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 6. macOS Terminal.app
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("defaults")
            .args(["read", "com.apple.Terminal", "Default Window Settings"])
            .output();
        if let Ok(o) = output {
            let profile = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !profile.is_empty() {
                let font_output = std::process::Command::new("defaults")
                    .args(["read", "com.apple.Terminal", "Window Settings"])
                    .output();
                if let Ok(fo) = font_output {
                    let text = String::from_utf8_lossy(&fo.stdout);
                    for line in text.lines() {
                        if line.contains("Font") && line.contains("data") {
                            // Font is stored as NSData, too complex to parse
                            // Fall through to system font detection
                            break;
                        }
                    }
                }
            }
        }
    }

    // 7. Check what monospace/nerd fonts are actually installed
    #[cfg(target_os = "macos")]
    {
        // Faster check via font file existence
        let font_dirs = [
            format!("{home}/Library/Fonts"),
            "/Library/Fonts".to_string(),
            "/System/Library/Fonts".to_string(),
        ];

        // (File name substring, CSS font-family name)
        let preferred = [
            ("MesloLGS NF", "MesloLGS NF"),
            ("MesloLGS Nerd Font", "MesloLGS Nerd Font Mono"),
            ("JetBrainsMono NF", "JetBrainsMono NFM"),
            ("JetBrains Mono Nerd Font", "JetBrainsMono Nerd Font"),
            ("Hack NF", "Hack NF"),
            ("Hack Nerd Font", "Hack Nerd Font"),
            ("FiraCode NF", "FiraCode NF"),
            ("FiraCode Nerd Font", "FiraCode Nerd Font"),
            ("JetBrains Mono", "JetBrains Mono"),
            ("SF-Mono", "SF Mono"),
            ("Menlo", "Menlo"),
        ];

        for (file_hint, css_name) in preferred {
            let search_term = file_hint.replace(' ', "").to_lowercase();
            for dir in &font_dirs {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let file_name = entry.file_name().to_string_lossy().to_string();
                        let name_lower = file_name.replace(' ', "").to_lowercase();
                        if name_lower.contains(&search_term) {
                            return Ok(css_name.to_string());
                        }
                    }
                }
            }
        }
    }

    // 7b. Linux — use fc-list
    #[cfg(not(target_os = "macos"))]
    {
        let preferred = [
            "MesloLGS Nerd Font Mono",
            "MesloLGS NF",
            "JetBrainsMono Nerd Font Mono",
            "Hack Nerd Font Mono",
            "FiraCode Nerd Font Mono",
            "JetBrains Mono",
            "DejaVu Sans Mono",
        ];

        if let Ok(output) = std::process::Command::new("fc-list")
            .args([":spacing=100", "family"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
            for font_name in preferred {
                if text.contains(&font_name.to_lowercase()) {
                    return Ok(font_name.to_string());
                }
            }
        }
    }

    // 8. Nothing found — return empty, frontend uses platform default
    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

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
