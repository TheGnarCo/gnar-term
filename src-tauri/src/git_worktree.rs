use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
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
    run_git(
        &repo_path,
        &["worktree", "add", "-b", &branch, &worktree_path, &base],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    validate_repo(&repo_path)?;
    run_git(
        &repo_path,
        &["worktree", "remove", "--force", &worktree_path],
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
}
