use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GhAuthor {
    pub login: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GhLabel {
    pub name: String,
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPr {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub author: GhAuthor,
    pub labels: Vec<GhLabel>,
    pub created_at: String,
    pub url: String,
    pub head_ref_name: String,
    pub is_draft: bool,
}

fn validate_repo(repo_path: &str) -> Result<(), String> {
    let path = Path::new(repo_path);
    if !path.exists() {
        return Err(format!("Repository path does not exist: {repo_path}"));
    }
    if !path.is_dir() {
        return Err(format!("Repository path is not a directory: {repo_path}"));
    }
    Ok(())
}

fn check_gh_installed() -> Result<(), String> {
    Command::new("gh")
        .arg("--version")
        .output()
        .map_err(|_| "GitHub CLI (gh) is not installed".to_string())?;
    Ok(())
}

fn run_gh_command(repo_path: &str, args: &[&str]) -> Result<String, String> {
    check_gh_installed()?;
    validate_repo(repo_path)?;

    let output = Command::new("gh")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute gh command: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr.trim();
        return Err(format!("gh command failed: {msg}"));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Failed to parse gh output as UTF-8: {e}"))
}

fn parse_prs(json: &str) -> Result<Vec<GhPr>, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse PR JSON: {e}"))
}

#[tauri::command]
pub async fn gh_list_prs(repo_path: String, state: Option<String>) -> Result<Vec<GhPr>, String> {
    let mut args = vec![
        "pr",
        "list",
        "--json",
        "number,title,state,author,labels,createdAt,url,headRefName,isDraft",
        "--limit",
        "50",
    ];

    let state_value;
    if let Some(ref s) = state {
        args.push("--state");
        state_value = s.clone();
        args.push(&state_value);
    }

    let output = run_gh_command(&repo_path, &args)?;
    parse_prs(&output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_prs_empty_array() {
        assert!(parse_prs("[]").unwrap().is_empty());
    }

    #[test]
    fn parse_prs_malformed_json_returns_error() {
        assert!(parse_prs("not json").is_err());
    }
}
