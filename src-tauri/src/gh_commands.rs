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
pub struct GhIssue {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub author: GhAuthor,
    pub labels: Vec<GhLabel>,
    pub created_at: String,
    pub url: String,
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
        return Err(format!("Repository path does not exist: {}", repo_path));
    }
    if !path.is_dir() {
        return Err(format!("Repository path is not a directory: {}", repo_path));
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
        .map_err(|e| format!("Failed to execute gh command: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh command failed: {}", stderr.trim()));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to parse gh output as UTF-8: {}", e))
}

pub fn parse_issues(json: &str) -> Result<Vec<GhIssue>, String> {
    serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse issue JSON: {}", e))
}

pub fn parse_prs(json: &str) -> Result<Vec<GhPr>, String> {
    serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse PR JSON: {}", e))
}

#[tauri::command]
pub async fn gh_list_issues(
    repo_path: String,
    state: Option<String>,
) -> Result<Vec<GhIssue>, String> {
    let mut args = vec![
        "issue",
        "list",
        "--json",
        "number,title,state,author,labels,createdAt,url",
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
    parse_issues(&output)
}

#[tauri::command]
pub async fn gh_list_prs(
    repo_path: String,
    state: Option<String>,
) -> Result<Vec<GhPr>, String> {
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

    const SAMPLE_ISSUES_JSON: &str = r#"[
        {
            "number": 42,
            "title": "Fix login bug",
            "state": "OPEN",
            "author": {"login": "octocat"},
            "labels": [{"name": "bug", "color": "d73a4a"}],
            "createdAt": "2024-01-15T10:30:00Z",
            "url": "https://github.com/owner/repo/issues/42"
        },
        {
            "number": 43,
            "title": "Add dark mode",
            "state": "CLOSED",
            "author": {"login": "contributor"},
            "labels": [],
            "createdAt": "2024-01-16T14:00:00Z",
            "url": "https://github.com/owner/repo/issues/43"
        }
    ]"#;

    const SAMPLE_PRS_JSON: &str = r#"[
        {
            "number": 10,
            "title": "feat: add sidebar",
            "state": "OPEN",
            "author": {"login": "dev1"},
            "labels": [{"name": "enhancement", "color": "a2eeef"}],
            "createdAt": "2024-02-01T09:00:00Z",
            "url": "https://github.com/owner/repo/pull/10",
            "headRefName": "feat/sidebar",
            "isDraft": false
        },
        {
            "number": 11,
            "title": "wip: refactor services",
            "state": "OPEN",
            "author": {"login": "dev2"},
            "labels": [],
            "createdAt": "2024-02-02T11:30:00Z",
            "url": "https://github.com/owner/repo/pull/11",
            "headRefName": "refactor/services",
            "isDraft": true
        }
    ]"#;

    #[test]
    fn test_parse_issues_valid_json() {
        let issues = parse_issues(SAMPLE_ISSUES_JSON).unwrap();
        assert_eq!(issues.len(), 2);

        assert_eq!(issues[0].number, 42);
        assert_eq!(issues[0].title, "Fix login bug");
        assert_eq!(issues[0].state, "OPEN");
        assert_eq!(issues[0].author.login, "octocat");
        assert_eq!(issues[0].labels.len(), 1);
        assert_eq!(issues[0].labels[0].name, "bug");
        assert_eq!(issues[0].labels[0].color, "d73a4a");
        assert_eq!(issues[0].created_at, "2024-01-15T10:30:00Z");
        assert_eq!(
            issues[0].url,
            "https://github.com/owner/repo/issues/42"
        );

        assert_eq!(issues[1].number, 43);
        assert_eq!(issues[1].state, "CLOSED");
        assert_eq!(issues[1].labels.len(), 0);
    }

    #[test]
    fn test_parse_prs_valid_json() {
        let prs = parse_prs(SAMPLE_PRS_JSON).unwrap();
        assert_eq!(prs.len(), 2);

        assert_eq!(prs[0].number, 10);
        assert_eq!(prs[0].title, "feat: add sidebar");
        assert_eq!(prs[0].head_ref_name, "feat/sidebar");
        assert_eq!(prs[0].is_draft, false);
        assert_eq!(prs[0].author.login, "dev1");
        assert_eq!(prs[0].labels.len(), 1);
        assert_eq!(prs[0].labels[0].name, "enhancement");

        assert_eq!(prs[1].number, 11);
        assert_eq!(prs[1].head_ref_name, "refactor/services");
        assert_eq!(prs[1].is_draft, true);
        assert_eq!(prs[1].labels.len(), 0);
    }

    #[test]
    fn test_parse_issues_empty_array() {
        let issues = parse_issues("[]").unwrap();
        assert_eq!(issues.len(), 0);
    }

    #[test]
    fn test_parse_prs_empty_array() {
        let prs = parse_prs("[]").unwrap();
        assert_eq!(prs.len(), 0);
    }

    #[test]
    fn test_parse_issues_invalid_json() {
        let result = parse_issues("not json");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse issue JSON"));
    }

    #[test]
    fn test_parse_prs_invalid_json() {
        let result = parse_prs("{malformed}");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to parse PR JSON"));
    }

    #[test]
    fn test_parse_issues_missing_field() {
        let json = r#"[{"number": 1, "title": "test"}]"#;
        let result = parse_issues(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_prs_missing_field() {
        let json = r#"[{"number": 1, "title": "test"}]"#;
        let result = parse_prs(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_repo_nonexistent_path() {
        let result = validate_repo("/nonexistent/path/that/does/not/exist");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_validate_repo_file_not_directory() {
        // Use Cargo.toml as a known file that exists but is not a directory
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let cargo_toml = format!("{}/Cargo.toml", manifest_dir);
        let result = validate_repo(&cargo_toml);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    #[test]
    fn test_validate_repo_valid_directory() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let result = validate_repo(manifest_dir);
        assert!(result.is_ok());
    }
}
