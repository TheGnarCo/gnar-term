//! Claude Code auto-registration.
//!
//! On first launch when the MCP module is enabled, we register gnar-term in
//! `~/.claude.json` under `mcpServers.gnar-term` so Claude Code knows how to
//! spawn the `--mcp-stdio` shim. We prefer the supported CLI path
//! (`claude mcp add-json -s user`) and fall back to an atomic direct write of
//! `~/.claude.json` if the CLI isn't available or refuses the write.
//!
//! All failures are logged to stderr and swallowed — they never crash the GUI.

use std::path::PathBuf;
use std::process::Command;

/// Whether Claude Code appears to be installed.
pub fn detect_claude_code() -> bool {
    // `claude` on PATH or `~/.claude.json` exists.
    if Command::new("claude").arg("--version").output().is_ok() {
        return true;
    }
    if let Some(home) = std::env::var_os("HOME") {
        let p: PathBuf = [home.as_os_str(), std::ffi::OsStr::new(".claude.json")]
            .iter()
            .collect();
        if p.exists() {
            return true;
        }
    }
    false
}

/// Build the JSON payload `claude mcp add-json` expects.
pub fn build_payload(binary_path: &str) -> String {
    format!(
        "{{\"type\":\"stdio\",\"command\":\"{}\",\"args\":[\"--mcp-stdio\"],\"env\":{{}}}}",
        binary_path.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

/// Path to `~/.claude.json`.
fn claude_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        [home.as_os_str(), std::ffi::OsStr::new(".claude.json")]
            .iter()
            .collect(),
    )
}

/// Check whether `~/.claude.json` already registers gnar-term at the given path.
pub fn already_registered(binary_path: &str) -> bool {
    let Some(path) = claude_config_path() else {
        return false;
    };
    let Ok(content) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };
    let command = value
        .get("mcpServers")
        .and_then(|m| m.get("gnar-term"))
        .and_then(|g| g.get("command"))
        .and_then(|c| c.as_str());
    command == Some(binary_path)
}

/// Register via `claude mcp add-json`. Returns Ok on success.
fn register_via_cli(binary_path: &str) -> Result<(), String> {
    let payload = build_payload(binary_path);
    let output = Command::new("claude")
        .args(["mcp", "add-json", "-s", "user", "gnar-term", &payload])
        .output()
        .map_err(|e| format!("spawn claude: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "claude mcp add-json exited {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Fallback: atomic direct write to `~/.claude.json`.
fn register_via_direct_write(binary_path: &str) -> Result<(), String> {
    let path = claude_config_path().ok_or_else(|| "HOME not set".to_string())?;
    let existing: serde_json::Value = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    };
    let mut root = existing;
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    servers.as_object_mut().unwrap().insert(
        "gnar-term".to_string(),
        serde_json::json!({
            "type": "stdio",
            "command": binary_path,
            "args": ["--mcp-stdio"],
            "env": {}
        }),
    );
    let serialized = serde_json::to_string_pretty(&root).map_err(|e| format!("serialize: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serialized).map_err(|e| format!("write temp: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Register gnar-term with Claude Code if not already registered at the given
/// binary path. Idempotent; errors are logged but not propagated.
pub fn register_if_needed(binary_path: &str) {
    if already_registered(binary_path) {
        return;
    }
    if let Err(cli_err) = register_via_cli(binary_path) {
        eprintln!("[mcp-register] cli path failed: {cli_err}; trying direct write");
        if let Err(write_err) = register_via_direct_write(binary_path) {
            eprintln!("[mcp-register] direct write failed: {write_err}");
            eprintln!(
                "[mcp-register] manual command: claude mcp add-json -s user gnar-term '{}'",
                build_payload(binary_path)
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_is_valid_json() {
        let p = build_payload("/usr/local/bin/gnar-term");
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["type"], "stdio");
        assert_eq!(v["command"], "/usr/local/bin/gnar-term");
        assert_eq!(v["args"][0], "--mcp-stdio");
    }

    #[test]
    fn payload_escapes_backslashes_for_windows_paths() {
        let p = build_payload(r"C:\Program Files\gnar-term\gnar-term.exe");
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["command"], r"C:\Program Files\gnar-term\gnar-term.exe");
    }
}
