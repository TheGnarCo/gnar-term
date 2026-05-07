use crate::git_helpers::{run_git, validate_git_ref, validate_repo};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

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

    // Reject `..` components upfront. The canonicalize-based check below
    // collapses `..` against existing on-disk parents, but a path whose
    // ancestor walk lands inside HOME may still embed traversal that
    // resolves elsewhere on first use. Disallowing `..` syntactically is
    // both cheaper and harder to fool than relying on canonicalization
    // alone.
    if path.components().any(|c| c == Component::ParentDir) {
        return Err(format!(
            "worktree path must not contain '..': {worktree_path}"
        ));
    }

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

fn parse_branch_list(
    output: &str,
    include_remote: bool,
    current_branch: Option<&str>,
) -> Vec<BranchInfo> {
    // Lowercase the symbolic-ref name once for case-insensitive matching:
    // on case-insensitive filesystems HEAD can be `jrvs/foo` while the
    // on-disk ref is `Jrvs/foo`, and `git branch` displays the latter.
    let current_lower = current_branch.map(str::to_lowercase);
    let mut branches = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        // Detect the `* ` current-marker prefix before trimming, so that
        // an empty current-marker line like `* \n` (case-insensitive FS
        // quirk) isn't mistaken for a branch named `*`.
        let starred = line.starts_with("* ");
        let name_raw = if starred {
            line[2..].trim()
        } else {
            line.trim()
        };
        if name_raw.is_empty() || name_raw.starts_with('(') {
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
        let is_current = !is_remote
            && match current_lower.as_deref() {
                Some(cur) => name.to_lowercase() == cur,
                None => starred,
            };
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
    // `symbolic-ref --short HEAD` reliably returns the current branch even
    // when `git branch` outputs an empty `* ` line (case-insensitive FS:
    // HEAD points to `jrvs/foo` but the on-disk ref is `Jrvs/foo`).
    // Errors out in detached HEAD state, in which case we fall back to
    // `*` prefix detection in parse_branch_list.
    let current = run_git(&repo_path, &["symbolic-ref", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string());
    let args: Vec<&str> = if include_remote {
        vec!["branch", "-a"]
    } else {
        vec!["branch"]
    };
    let output = run_git(&repo_path, &args)?;
    Ok(parse_branch_list(
        &output,
        include_remote,
        current.as_deref(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_branch_list_local_only() {
        let output = "  develop\n* main\n  feature/auth\n";
        let result = parse_branch_list(output, false, None);
        assert_eq!(result.len(), 3);
        assert_eq!(result[1].name, "main");
        assert!(result[1].is_current);
    }

    #[test]
    fn parse_branch_list_skips_head_pointer() {
        let output = "* main\n  remotes/origin/HEAD -> origin/main\n  remotes/origin/main\n";
        let result = parse_branch_list(output, true, None);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "main");
        assert_eq!(result[1].name, "origin/main");
    }

    /// Regression: on case-insensitive filesystems (macOS APFS) `git branch`
    /// can emit a `* ` current-marker line with no name when HEAD points to
    /// `jrvs/foo` but the on-disk ref is `Jrvs/foo`. We must skip the empty
    /// marker line and instead match the symbolic-ref name case-insensitively
    /// against the listed branches, otherwise the UI shows `…` forever.
    #[test]
    fn parse_branch_list_marks_case_mismatched_current_branch() {
        let output = "* \n  Jrvs/may-refresh\n  main\n";
        let result = parse_branch_list(output, false, Some("jrvs/may-refresh"));
        assert_eq!(result.len(), 2, "empty `* ` line should be skipped");
        let current = result.iter().find(|b| b.is_current);
        assert!(
            current.is_some(),
            "expected case-mismatched branch to be marked current"
        );
        assert_eq!(current.unwrap().name, "Jrvs/may-refresh");
    }

    /// Detached HEAD: symbolic-ref errors out, so we fall back to the `*`
    /// prefix marker. The `(HEAD detached at …)` line is always skipped.
    #[test]
    fn parse_branch_list_falls_back_to_starred_when_no_symbolic_ref() {
        let output = "* (HEAD detached at abc1234)\n  main\n  feature/x\n";
        let result = parse_branch_list(output, false, None);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|b| !b.is_current));
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
            err.contains("must not start with '-'") || err.contains("invalid characters"),
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
            err.contains("must not start with '-'") || err.contains("invalid characters"),
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
    /// directory that doesn't exist yet must still validate. `canonicalize()`
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

    /// `..` traversal must be rejected syntactically — even when the
    /// canonicalized result happens to land inside HOME, embedding `..`
    /// in worktree paths is never legitimate input.
    #[test]
    fn validate_worktree_path_rejects_parent_traversal() {
        let home = std::env::var("HOME").expect("HOME set");
        let target = format!("{home}/foo/../bar");
        let result = validate_worktree_path(&target);
        assert!(result.is_err(), "expected '..' rejection, got: {result:?}");
        let err = result.unwrap_err();
        assert!(
            err.contains("must not contain '..'"),
            "expected traversal rejection message, got: {err}"
        );
    }
}
