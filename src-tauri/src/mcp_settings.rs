use crate::mcp_register;

/// Read the `mcp` setting from `gnar-term.json`. Returns `"auto"` if no
/// config exists or the field is missing. Values that aren't recognized fall
/// back to `"auto"`.
fn read_mcp_setting() -> String {
    let paths: Vec<std::path::PathBuf> = {
        let mut v = Vec::new();
        v.push(std::path::PathBuf::from("gnar-term.json"));
        v.push(std::path::PathBuf::from("cmux.json"));
        if let Ok(home) = std::env::var("HOME") {
            v.push(std::path::PathBuf::from(format!(
                "{}/.config/gnar-term/gnar-term.json",
                home
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
pub(crate) fn mcp_should_start() -> bool {
    match read_mcp_setting().as_str() {
        "off" => false,
        "on" => true,
        _ => mcp_register::detect_claude_code(),
    }
}
