use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct FileStatus {
    pub path: String,
    pub status: String,
    pub staged: String,
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

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let joined = args.join(" ");
        return Err(format!("git {joined} failed: {stderr}"));
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Invalid UTF-8 in git output: {e}"))
}

fn parse_status_output(output: &str) -> Vec<FileStatus> {
    let mut statuses = Vec::new();
    for line in output.lines() {
        if line.len() < 3 {
            continue;
        }
        let staged = line.chars().next().unwrap_or(' ').to_string();
        let status = line.chars().nth(1).unwrap_or(' ').to_string();
        let path = line[3..].to_string();
        statuses.push(FileStatus {
            path,
            status,
            staged,
        });
    }
    statuses
}

#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<Vec<FileStatus>, String> {
    validate_repo(&repo_path)?;
    let output = run_git(&repo_path, &["status", "--porcelain"])?;
    Ok(parse_status_output(&output))
}

/// Strip any `user:password@` or `user@` prefix from the authority
/// component of a URL so credentials are never sent to the frontend.
/// SSH-style `git@github.com:org/repo` is returned unchanged (no `://`).
fn strip_userinfo(url: &str) -> String {
    let Some(scheme_end) = url.find("://") else {
        return url.to_string();
    };
    let auth_start = scheme_end + 3;
    let auth_end = url[auth_start..]
        .find('/')
        .map_or(url.len(), |i| auth_start + i);
    match url[auth_start..auth_end].rfind('@') {
        Some(at) => format!("{}{}", &url[..auth_start], &url[auth_start + at + 1..]),
        None => url.to_string(),
    }
}

/// Return the origin remote URL for `repo_path`, or an empty string
/// when the repo has no `origin` remote configured. Callers use this
/// to derive the repository's GitHub web URL for dashboard links.
/// Userinfo (credentials) are stripped before returning.
#[tauri::command]
pub async fn git_remote_url(repo_path: String) -> Result<String, String> {
    validate_repo(&repo_path)?;
    match run_git(&repo_path, &["config", "--get", "remote.origin.url"]) {
        Ok(out) => Ok(strip_userinfo(out.trim())),
        // Git exits non-zero when the config key is missing; treat that
        // as "no remote" rather than an error to the caller.
        Err(_) => Ok(String::new()),
    }
}

/// Validate a git ref string against a strict allowlist of characters.
///
/// Accepts only alphanumeric characters plus hyphen, underscore, dot,
/// slash, and `@` — the characters that appear in valid git ref names,
/// branch names, and commit SHAs. Rejects anything else to prevent
/// ref-parsing edge cases from reaching git.
fn validate_git_ref(r: &str) -> Result<(), String> {
    if r.is_empty() {
        return Err("git ref must not be empty".to_string());
    }
    let invalid: Vec<char> = r
        .chars()
        .filter(|c| !matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '/' | '@' | '{' | '}'))
        .collect();
    if invalid.is_empty() {
        Ok(())
    } else {
        Err(format!("git ref contains invalid characters: {invalid:?}"))
    }
}

/// Return the raw unified-diff text for a repository. All filter args
/// are optional and compose:
///   - `staged = true`         → `git diff --staged`
///   - `base` set, `head` set  → `git diff base..head` (triple-dot
///                                not used; branches-at-tip, not
///                                merge-base)
///   - `base` set only         → `git diff base`
///   - `file` set              → appends `-- <file>` so the diff
///                                scopes to that path
///   - none of the above       → `git diff` (unstaged working-tree
///                                changes)
/// Callers in `diff-viewer` rely on the raw unified output and parse
/// it themselves; no formatting flags are added here.
#[tauri::command]
pub async fn git_diff(
    repo_path: String,
    file: Option<String>,
    base: Option<String>,
    head: Option<String>,
    staged: Option<bool>,
) -> Result<String, String> {
    validate_repo(&repo_path)?;
    let mut args: Vec<String> = vec!["diff".to_string()];
    if staged.unwrap_or(false) {
        args.push("--staged".to_string());
    }
    args.push("--end-of-options".to_string());
    if let Some(b) = base.as_deref() {
        validate_git_ref(b)?;
    }
    if let Some(h) = head.as_deref() {
        validate_git_ref(h)?;
    }
    match (base.as_deref(), head.as_deref()) {
        (Some(b), Some(h)) => args.push(format!("{b}..{h}")),
        (Some(b), None) => args.push(b.to_string()),
        _ => {}
    }
    if let Some(f) = file {
        args.push("--".to_string());
        args.push(f);
    }
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    // `git diff` exits non-zero when the requested ref/path is bogus
    // but also when there are conflicts; the former is a genuine
    // error, the latter still produces useful stdout. We surface any
    // non-zero exit as an error so the extension can toast it.
    run_git(&repo_path, &args_ref)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_status_modified_and_untracked() {
        let output = " M src/main.rs\n?? new.txt\nM  staged.rs\n";
        let r = parse_status_output(output);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].path, "src/main.rs");
        assert_eq!(r[0].status, "M");
        assert_eq!(r[1].staged, "?");
        assert_eq!(r[2].staged, "M");
    }

    #[test]
    fn parse_status_empty() {
        assert!(parse_status_output("").is_empty());
    }

    #[test]
    fn strip_userinfo_removes_user_and_password() {
        assert_eq!(
            strip_userinfo("https://oauth-token:ghp_abc123@github.com/org/repo"),
            "https://github.com/org/repo"
        );
    }

    #[test]
    fn strip_userinfo_removes_user_only() {
        assert_eq!(
            strip_userinfo("https://user@github.com/org/repo"),
            "https://github.com/org/repo"
        );
    }

    #[test]
    fn strip_userinfo_at_in_password_uses_last_at() {
        assert_eq!(
            strip_userinfo("https://user:p@ssword@github.com/org/repo"),
            "https://github.com/org/repo"
        );
    }

    #[test]
    fn strip_userinfo_leaves_ssh_style_unchanged() {
        let url = "git@github.com:org/repo.git";
        assert_eq!(strip_userinfo(url), url);
    }

    #[test]
    fn strip_userinfo_leaves_plain_https_unchanged() {
        let url = "https://github.com/org/repo";
        assert_eq!(strip_userinfo(url), url);
    }

    // --- validate_git_ref tests (F33) ---

    #[test]
    fn git_ref_accepts_branch_names() {
        assert!(validate_git_ref("main").is_ok());
        assert!(validate_git_ref("feature/my-branch").is_ok());
        assert!(validate_git_ref("v1.2.3").is_ok());
        assert!(validate_git_ref("HEAD@{1}").is_ok());
        assert!(validate_git_ref("abc1234def5678").is_ok());
    }

    #[test]
    fn git_ref_rejects_empty_string() {
        assert!(validate_git_ref("").is_err());
    }

    #[test]
    fn git_ref_rejects_shell_special_chars() {
        assert!(validate_git_ref("main;rm -rf /").is_err());
        assert!(validate_git_ref("$(evil)").is_err());
        assert!(validate_git_ref("main\x00evil").is_err());
        assert!(validate_git_ref("branch name").is_err()); // space
    }

    #[test]
    fn git_ref_rejects_tilde_and_caret() {
        // ~ and ^ have special meaning to git's rev-parse and are not in the allowlist
        assert!(validate_git_ref("HEAD~1").is_err());
        assert!(validate_git_ref("HEAD^").is_err());
    }
}
