use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

static SHELL_PATH: OnceLock<String> = OnceLock::new();

fn shell_path() -> &'static str {
    SHELL_PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        if let Ok(out) = Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
        std::env::var("PATH").unwrap_or_default()
    })
}

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
        .env("PATH", shell_path())
        .output()
        .map_err(|_| "GitHub CLI (gh) is not installed".to_string())?;
    Ok(())
}

fn run_gh_command(repo_path: &str, args: &[&str]) -> Result<String, String> {
    check_gh_installed()?;
    validate_repo(repo_path)?;

    let output = Command::new("gh")
        .args(args)
        .env("PATH", shell_path())
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

fn parse_issues(json: &str) -> Result<Vec<GhIssue>, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse issue JSON: {e}"))
}

fn validate_state(state: &str) -> Result<(), String> {
    match state {
        "open" | "closed" | "all" => Ok(()),
        _ => Err(format!(
            "invalid state '{state}': must be one of open, closed, all"
        )),
    }
}

fn build_list_args<'a>(
    subcommand: &'a str,
    json_fields: &'a str,
    state: Option<&'a str>,
) -> Result<Vec<&'a str>, String> {
    if let Some(s) = state {
        validate_state(s)?;
    }
    let mut args = vec![subcommand, "list", "--json", json_fields, "--limit", "50"];
    if let Some(s) = state {
        args.push("--state");
        args.push(s);
    }
    Ok(args)
}

/// Minimal PR data returned by `gh_view_pr` — fields needed for a
/// compact statusline. Does not include author/labels/timestamps.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPrView {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub url: String,
    pub head_ref_name: String,
    pub is_draft: bool,
    /// Derived from statusCheckRollup: "SUCCESS" | "FAILURE" | "PENDING" | "NONE"
    pub ci_status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckStatus {
    conclusion: Option<String>,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrView {
    number: u32,
    title: String,
    state: String,
    url: String,
    head_ref_name: String,
    is_draft: bool,
    #[serde(default)]
    status_check_rollup: Vec<CheckStatus>,
}

fn derive_ci_status(checks: &[CheckStatus]) -> String {
    if checks.is_empty() {
        return "NONE".to_string();
    }
    let has_failure = checks.iter().any(|c| {
        matches!(
            c.conclusion.as_deref(),
            Some("FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE")
        )
    });
    if has_failure {
        return "FAILURE".to_string();
    }
    let has_pending = checks.iter().any(|c| {
        matches!(
            c.status.as_deref(),
            Some("IN_PROGRESS" | "QUEUED" | "WAITING" | "PENDING")
        ) || c.conclusion.is_none()
    });
    if has_pending {
        return "PENDING".to_string();
    }
    "SUCCESS".to_string()
}

fn parse_pr_view(json: &str) -> Result<GhPrView, String> {
    let raw: RawPrView =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse PR JSON: {e}"))?;
    Ok(GhPrView {
        number: raw.number,
        title: raw.title,
        state: raw.state,
        url: raw.url,
        head_ref_name: raw.head_ref_name,
        is_draft: raw.is_draft,
        ci_status: derive_ci_status(&raw.status_check_rollup),
    })
}

/// Return the open PR for the current branch in `repo_path`, or `None`
/// when there is no PR. Non-zero exit from `gh` is treated as "no PR"
/// rather than an error — this is the normal case for branches that
/// haven't been pushed as a PR yet.
#[tauri::command]
pub async fn gh_view_pr(repo_path: String) -> Result<Option<GhPrView>, String> {
    validate_repo(&repo_path)?;
    let output = Command::new("gh")
        .args([
            "pr",
            "view",
            "--json",
            "number,title,state,url,isDraft,headRefName,statusCheckRollup",
        ])
        .env("PATH", shell_path())
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to execute gh command: {e}"))?;

    if !output.status.success() {
        return Ok(None);
    }

    let json = String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to parse gh output as UTF-8: {e}"))?;
    Ok(Some(parse_pr_view(&json)?))
}

/// Probe whether the `gh` binary is available on PATH. Used by
/// `gh-availability.ts` on the frontend to skip doomed invokes and render
/// an actionable empty state instead of a terse error line.
#[tauri::command]
pub async fn gh_available() -> Result<bool, String> {
    Ok(Command::new("gh")
        .arg("--version")
        .env("PATH", shell_path())
        .output()
        .is_ok())
}

#[tauri::command]
pub async fn gh_list_issues(
    repo_path: String,
    state: Option<String>,
) -> Result<Vec<GhIssue>, String> {
    let args = build_list_args(
        "issue",
        "number,title,state,author,labels,createdAt,url",
        state.as_deref(),
    )?;
    let output = run_gh_command(&repo_path, &args)?;
    parse_issues(&output)
}

#[tauri::command]
pub async fn gh_list_prs(repo_path: String, state: Option<String>) -> Result<Vec<GhPr>, String> {
    let args = build_list_args(
        "pr",
        "number,title,state,author,labels,createdAt,url,headRefName,isDraft",
        state.as_deref(),
    )?;
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

    #[test]
    fn parse_issues_empty_array() {
        assert!(parse_issues("[]").unwrap().is_empty());
    }

    #[test]
    fn parse_issues_malformed_json_returns_error() {
        assert!(parse_issues("not json").is_err());
    }

    #[test]
    fn validate_state_accepts_valid_values() {
        assert!(validate_state("open").is_ok());
        assert!(validate_state("closed").is_ok());
        assert!(validate_state("all").is_ok());
    }

    #[test]
    fn validate_state_rejects_unknown() {
        assert!(validate_state("merged").is_err());
        assert!(validate_state("").is_err());
    }

    #[test]
    fn build_list_args_without_state() {
        let args = build_list_args("issue", "number,title", None).unwrap();
        assert_eq!(
            args,
            vec!["issue", "list", "--json", "number,title", "--limit", "50"]
        );
    }

    #[test]
    fn build_list_args_with_valid_state() {
        let args = build_list_args("pr", "number", Some("open")).unwrap();
        assert!(args.contains(&"--state"));
        assert!(args.contains(&"open"));
    }

    #[test]
    fn build_list_args_rejects_invalid_state() {
        assert!(build_list_args("issue", "number", Some("merged")).is_err());
    }

    #[test]
    fn parse_pr_view_valid_json() {
        let json = r#"{
            "number": 42,
            "title": "feat: add diff statusline",
            "state": "OPEN",
            "url": "https://github.com/org/repo/pull/42",
            "headRefName": "feat/diff-statusline",
            "isDraft": false
        }"#;
        let pr = parse_pr_view(json).unwrap();
        assert_eq!(pr.number, 42);
        assert_eq!(pr.title, "feat: add diff statusline");
        assert_eq!(pr.state, "OPEN");
        assert!(!pr.is_draft);
        assert_eq!(pr.head_ref_name, "feat/diff-statusline");
        assert_eq!(pr.ci_status, "NONE");
    }

    #[test]
    fn parse_pr_view_draft() {
        let json = r#"{
            "number": 7,
            "title": "WIP",
            "state": "OPEN",
            "url": "https://github.com/org/repo/pull/7",
            "headRefName": "wip/branch",
            "isDraft": true
        }"#;
        let pr = parse_pr_view(json).unwrap();
        assert!(pr.is_draft);
    }

    #[test]
    fn parse_pr_view_ci_status_passing() {
        let json = r#"{
            "number": 10,
            "title": "ci test",
            "state": "OPEN",
            "url": "https://github.com/org/repo/pull/10",
            "headRefName": "ci-branch",
            "isDraft": false,
            "statusCheckRollup": [
                {"conclusion": "SUCCESS", "status": "COMPLETED"},
                {"conclusion": "SKIPPED", "status": "COMPLETED"}
            ]
        }"#;
        let pr = parse_pr_view(json).unwrap();
        assert_eq!(pr.ci_status, "SUCCESS");
    }

    #[test]
    fn parse_pr_view_ci_status_failing() {
        let json = r#"{
            "number": 11,
            "title": "broken",
            "state": "OPEN",
            "url": "https://github.com/org/repo/pull/11",
            "headRefName": "broken",
            "isDraft": false,
            "statusCheckRollup": [
                {"conclusion": "SUCCESS", "status": "COMPLETED"},
                {"conclusion": "FAILURE", "status": "COMPLETED"}
            ]
        }"#;
        let pr = parse_pr_view(json).unwrap();
        assert_eq!(pr.ci_status, "FAILURE");
    }

    #[test]
    fn parse_pr_view_ci_status_pending() {
        let json = r#"{
            "number": 12,
            "title": "pending",
            "state": "OPEN",
            "url": "https://github.com/org/repo/pull/12",
            "headRefName": "pending",
            "isDraft": false,
            "statusCheckRollup": [
                {"conclusion": null, "status": "IN_PROGRESS"}
            ]
        }"#;
        let pr = parse_pr_view(json).unwrap();
        assert_eq!(pr.ci_status, "PENDING");
    }

    #[test]
    fn parse_pr_view_malformed_json_returns_error() {
        assert!(parse_pr_view("not json").is_err());
    }

    #[test]
    fn parse_pr_view_missing_field_returns_error() {
        let json = r#"{"number": 1, "title": "test"}"#;
        assert!(parse_pr_view(json).is_err());
    }
}
