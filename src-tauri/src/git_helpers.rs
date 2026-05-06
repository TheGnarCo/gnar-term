//! Shared git argument validation and process helpers.
//!
//! Used by `git_info`, `git_ops`, and `git_worktree` to prevent
//! argument injection when passing user-controlled branch/remote
//! names to git, and to share the repo-path / process-spawn boilerplate
//! that all three modules previously open-coded.

use std::path::Path;
use std::process::Command;

/// Validate that `repo_path` exists and is a directory.
pub fn validate_repo(repo_path: &str) -> Result<(), String> {
    let path = Path::new(repo_path);
    if !path.exists() {
        return Err(format!("Repository path does not exist: {repo_path}"));
    }
    if !path.is_dir() {
        return Err(format!("Repository path is not a directory: {repo_path}"));
    }
    Ok(())
}

/// Spawn `git <args>` in `repo_path` and return stdout on success
/// (lossy UTF-8). On failure returns a single-line error containing the
/// joined args, the exit code, and trimmed stderr.
pub fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "git {} failed (exit {}): {}",
            args.join(" "),
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ))
    }
}

/// Validate a git ref string against a strict allowlist of characters.
///
/// Accepts only alphanumeric characters plus hyphen, underscore, dot,
/// slash, `@`, and `{`/`}` (for reflog syntax like `HEAD@{1}`) — the
/// characters that appear in valid git ref names, branch names, commit
/// SHAs, and reflog selectors. Rejects anything else (shell
/// metacharacters, spaces, `..` ranges, leading dashes, null bytes,
/// `~`/`^` rev-parse modifiers) so user-controlled refs cannot be
/// interpreted as flags or shell substitutions when handed to git.
pub fn validate_git_ref(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("git ref must not be empty".to_string());
    }
    let invalid: Vec<char> = name
        .chars()
        .filter(|c| {
            !matches!(
                c,
                'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '/' | '@' | '{' | '}'
            )
        })
        .collect();
    if !invalid.is_empty() {
        return Err(format!("git ref contains invalid characters: {invalid:?}"));
    }
    if name.starts_with('-') {
        return Err(format!("git ref must not start with '-': {name:?}"));
    }
    if name.contains("..") {
        return Err(format!("git ref must not contain '..': {name:?}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_repo_nonexistent_path() {
        let result = validate_repo("/nonexistent/path/to/repo");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn validate_repo_file_not_dir() {
        let file_path = std::env::temp_dir().join("gnar-term-helpers-validate-repo-file");
        std::fs::write(&file_path, "not a dir").expect("write temp file");
        let result = validate_repo(file_path.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn validate_repo_valid_directory() {
        let result = validate_repo(env!("CARGO_MANIFEST_DIR"));
        assert!(result.is_ok());
    }

    #[test]
    fn valid_refs_pass() {
        assert!(validate_git_ref("main").is_ok());
        assert!(validate_git_ref("feature/foo-bar").is_ok());
        assert!(validate_git_ref("origin").is_ok());
        assert!(validate_git_ref("v1.2.3").is_ok());
        assert!(validate_git_ref("HEAD@{1}").is_ok());
        assert!(validate_git_ref("abc1234def5678").is_ok());
    }

    #[test]
    fn empty_ref_rejected() {
        assert!(validate_git_ref("").is_err());
    }

    #[test]
    fn leading_dash_rejected() {
        assert!(validate_git_ref("-bad").is_err());
        assert!(validate_git_ref("--upload-pack=malicious-cmd").is_err());
        assert!(validate_git_ref("--exec=evil").is_err());
    }

    #[test]
    fn double_dot_rejected() {
        assert!(validate_git_ref("main..feature").is_err());
        assert!(validate_git_ref("../secret").is_err());
        assert!(validate_git_ref("refs/heads/..hidden").is_err());
    }

    #[test]
    fn null_byte_rejected() {
        assert!(validate_git_ref("main\0evil").is_err());
    }

    #[test]
    fn shell_metacharacters_rejected() {
        assert!(validate_git_ref("main;rm -rf /").is_err());
        assert!(validate_git_ref("$(evil)").is_err());
        assert!(validate_git_ref("branch name").is_err()); // space
    }

    #[test]
    fn rev_parse_modifiers_rejected() {
        // `~` and `^` are git rev-parse syntax — useful in CLI contexts
        // but never legitimate when a user-named branch / remote / base
        // is being handed to git via this validator.
        assert!(validate_git_ref("HEAD~1").is_err());
        assert!(validate_git_ref("HEAD^").is_err());
    }
}
