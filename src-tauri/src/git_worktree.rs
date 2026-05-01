use crate::git_helpers::validate_git_ref;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

/// Validate a worktree path to prevent path traversal outside the home directory.
///
/// For paths that already exist, canonicalize directly. For new worktree paths
/// (`create_worktree`), canonicalize the parent directory and join the basename.
/// Either way, require the resolved path to be inside the user's home directory.
fn validate_worktree_path(worktree_path: &str) -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let home_path =
        std::fs::canonicalize(&home).map_err(|e| format!("failed to resolve HOME: {e}"))?;

    let path = Path::new(worktree_path);

    let canonical = if path.exists() {
        std::fs::canonicalize(path)
            .map_err(|e| format!("failed to resolve worktree path {worktree_path}: {e}"))?
    } else {
        // Path doesn't exist yet (create_worktree target). canonicalize()
        // requires every component on disk, so for first-time worktrees
        // (e.g. `.gnar-term/worktrees/foo` before the parent was ever
        // created) we walk up to the nearest existing ancestor, canonicalize
        // that, then re-join the missing tail. create_worktree mkdirs the
        // tail itself before invoking git.
        let existing_ancestor = path
            .ancestors()
            .skip(1)
            .find(|a| a.exists())
            .ok_or_else(|| format!("no existing ancestor for worktree path: {worktree_path}"))?;
        let resolved_ancestor = std::fs::canonicalize(existing_ancestor)
            .map_err(|e| format!("failed to resolve ancestor of worktree path: {e}"))?;
        let tail = path
            .strip_prefix(existing_ancestor)
            .map_err(|e| format!("failed to compute worktree path tail: {e}"))?;
        resolved_ancestor.join(tail)
    };

    if !canonical.starts_with(&home_path) {
        return Err(format!(
            "worktree path must be within home directory: {worktree_path}"
        ));
    }

    Ok(canonical)
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
        return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn parse_branch_list(output: &str, include_remote: bool) -> Vec<BranchInfo> {
    let mut branches = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let is_current = line.starts_with("* ");
        let name_raw = if is_current { &line[2..] } else { line }.trim();
        if name_raw.starts_with('(') {
            continue;
        }
        let is_remote = name_raw.starts_with("remotes/");
        if is_remote && !include_remote {
            continue;
        }
        let name = if is_remote {
            name_raw
                .strip_prefix("remotes/")
                .unwrap_or(name_raw)
                .to_string()
        } else {
            name_raw.to_string()
        };
        if name.contains(" -> ") {
            continue;
        }
        branches.push(BranchInfo {
            name,
            is_current,
            is_remote,
        });
    }
    branches
}

#[tauri::command]
pub async fn create_worktree(
    repo_path: String,
    branch: String,
    base: String,
    worktree_path: String,
) -> Result<(), String> {
    validate_repo(&repo_path)?;
    validate_git_ref(&branch)?;
    validate_git_ref(&base)?;
    let safe_path = validate_worktree_path(&worktree_path)?;
    let safe_path_str = safe_path
        .to_str()
        .ok_or_else(|| "worktree path contains invalid UTF-8".to_string())?;

    // Ensure parent directory exists
    let parent_dir = safe_path
        .parent()
        .ok_or_else(|| format!("worktree path has no parent directory: {worktree_path}"))?;
    std::fs::create_dir_all(parent_dir)
        .map_err(|e| format!("failed to create worktree parent directory: {e}"))?;

    run_git(
        &repo_path,
        &["worktree", "add", "-b", &branch, "--", safe_path_str, &base],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    validate_repo(&repo_path)?;
    let safe_path = validate_worktree_path(&worktree_path)?;
    let safe_path_str = safe_path
        .to_str()
        .ok_or_else(|| "worktree path contains invalid UTF-8".to_string())?;
    run_git(
        &repo_path,
        &["worktree", "remove", "--force", "--", safe_path_str],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn list_branches(
    repo_path: String,
    include_remote: bool,
) -> Result<Vec<BranchInfo>, String> {
    validate_repo(&repo_path)?;
    let args: Vec<&str> = if include_remote {
        vec!["branch", "-a"]
    } else {
        vec!["branch"]
    };
    let output = run_git(&repo_path, &args)?;
    Ok(parse_branch_list(&output, include_remote))
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
    fn validate_repo_valid_directory() {
        let result = validate_repo(env!("CARGO_MANIFEST_DIR"));
        assert!(result.is_ok());
    }

    #[test]
    fn parse_branch_list_local_only() {
        let output = "  develop\n* main\n  feature/auth\n";
        let result = parse_branch_list(output, false);
        assert_eq!(result.len(), 3);
        assert_eq!(result[1].name, "main");
        assert!(result[1].is_current);
    }

    #[test]
    fn parse_branch_list_skips_head_pointer() {
        let output = "* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n";
        let result = parse_branch_list(output, true);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "main");
        assert_eq!(result[1].name, "origin/main");
    }

    // F03 regressions: argument injection via branch/base names
    #[tokio::test]
    async fn create_worktree_rejects_injection_branch() {
        let result = create_worktree(
            env!("CARGO_MANIFEST_DIR").to_string(),
            "--upload-pack=evil".to_string(),
            "main".to_string(),
            "/tmp/wt-test".to_string(),
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must not start with '-'"),
            "expected injection rejection, got: {err}"
        );
    }

    #[tokio::test]
    async fn create_worktree_rejects_injection_base() {
        let result = create_worktree(
            env!("CARGO_MANIFEST_DIR").to_string(),
            "feature/x".to_string(),
            "--exec=evil".to_string(),
            "/tmp/wt-test".to_string(),
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must not start with '-'"),
            "expected injection rejection, got: {err}"
        );
    }

    // F03: worktree path must be within home directory
    #[test]
    fn validate_worktree_path_rejects_outside_home() {
        // /etc is never inside HOME
        let result = validate_worktree_path("/etc/passwd");
        assert!(result.is_err());
    }

    /// Regression: first-time worktree creation under a `.gnar-term/worktrees/`
    /// directory that doesn't exist yet must still validate. canonicalize()
    /// fails on non-existent dirs, so the validator walks up to the nearest
    /// existing ancestor before resolving — without this fix the user gets
    /// "failed to resolve parent of worktree path: No such file or directory"
    /// on every brand-new worktree-backed nested workspace.
    #[test]
    fn validate_worktree_path_accepts_missing_parent_under_home() {
        let home = std::env::var("HOME").expect("HOME set");
        // home/<missing-parent>/<missing-leaf> — only `home` itself exists.
        let target = format!("{home}/.gnar-term-test-missing-parent/leaf");
        let result = validate_worktree_path(&target);
        assert!(
            result.is_ok(),
            "expected non-existent path under HOME to validate, got: {result:?}"
        );
        let resolved = result.unwrap();
        assert!(
            resolved.ends_with(".gnar-term-test-missing-parent/leaf"),
            "resolved tail should be preserved, got: {resolved:?}"
        );
    }
}
