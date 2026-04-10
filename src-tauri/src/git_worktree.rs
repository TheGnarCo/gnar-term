use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct WorktreeInfo {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_bare: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
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

fn parse_worktree_list(output: &str) -> Vec<WorktreeInfo> {
    let mut worktrees = Vec::new();

    // Porcelain format: blocks separated by blank lines.
    // Each block has lines like:
    //   worktree /path/to/worktree
    //   HEAD abc123
    //   branch refs/heads/main
    // Bare worktrees have "bare" instead of "branch".
    for block in output.split("\n\n") {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }

        let mut path = String::new();
        let mut head = String::new();
        let mut branch: Option<String> = None;
        let mut is_bare = false;

        for line in block.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("worktree ") {
                path = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("HEAD ") {
                head = rest.to_string();
            } else if let Some(rest) = line.strip_prefix("branch ") {
                // Strip refs/heads/ prefix for a clean branch name
                branch = Some(
                    rest.strip_prefix("refs/heads/")
                        .unwrap_or(rest)
                        .to_string(),
                );
            } else if line == "bare" {
                is_bare = true;
            }
        }

        if !path.is_empty() {
            worktrees.push(WorktreeInfo {
                path,
                head,
                branch,
                is_bare,
            });
        }
    }

    worktrees
}

fn parse_branch_list(output: &str, include_remote: bool) -> Vec<BranchInfo> {
    let mut branches = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let is_current = line.starts_with("* ");
        let name_raw = if is_current {
            &line[2..]
        } else {
            line
        }
        .trim();

        // Skip detached HEAD indicators like "(HEAD detached at ...)"
        if name_raw.starts_with('(') {
            continue;
        }

        let is_remote = name_raw.starts_with("remotes/");

        // Skip remote branches when not requested
        if is_remote && !include_remote {
            continue;
        }

        // Clean up the name: strip "remotes/" prefix for display
        let name = if is_remote {
            name_raw
                .strip_prefix("remotes/")
                .unwrap_or(name_raw)
                .to_string()
        } else {
            name_raw.to_string()
        };

        // Skip HEAD pointers like "origin/HEAD -> origin/main"
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

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args.join(" "), stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
pub async fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    validate_repo(&repo_path)?;
    let output = run_git(&repo_path, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktree_list(&output))
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
    fn parse_worktree_list_basic() {
        let output = "\
worktree /home/user/project
HEAD abc123def456
branch refs/heads/main

worktree /home/user/project-feature
HEAD 789012abc345
branch refs/heads/feature/login

";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].path, "/home/user/project");
        assert_eq!(result[0].head, "abc123def456");
        assert_eq!(result[0].branch, Some("main".to_string()));
        assert!(!result[0].is_bare);

        assert_eq!(result[1].path, "/home/user/project-feature");
        assert_eq!(result[1].head, "789012abc345");
        assert_eq!(result[1].branch, Some("feature/login".to_string()));
        assert!(!result[1].is_bare);
    }

    #[test]
    fn parse_worktree_list_bare() {
        let output = "\
worktree /home/user/project.git
HEAD abc123def456
bare

";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 1);
        assert!(result[0].is_bare);
        assert_eq!(result[0].branch, None);
    }

    #[test]
    fn parse_worktree_list_empty() {
        let result = parse_worktree_list("");
        assert!(result.is_empty());
    }

    #[test]
    fn parse_worktree_list_mixed() {
        let output = "\
worktree /home/user/repo.git
HEAD aaa111
bare

worktree /home/user/repo-main
HEAD bbb222
branch refs/heads/main

worktree /home/user/repo-dev
HEAD ccc333
branch refs/heads/develop

";
        let result = parse_worktree_list(output);
        assert_eq!(result.len(), 3);
        assert!(result[0].is_bare);
        assert_eq!(result[1].branch, Some("main".to_string()));
        assert_eq!(result[2].branch, Some("develop".to_string()));
    }

    #[test]
    fn parse_branch_list_local_only() {
        let output = "\
  develop
* main
  feature/auth
";
        let result = parse_branch_list(output, false);
        assert_eq!(result.len(), 3);

        assert_eq!(result[0].name, "develop");
        assert!(!result[0].is_current);
        assert!(!result[0].is_remote);

        assert_eq!(result[1].name, "main");
        assert!(result[1].is_current);
        assert!(!result[1].is_remote);

        assert_eq!(result[2].name, "feature/auth");
        assert!(!result[2].is_current);
        assert!(!result[2].is_remote);
    }

    #[test]
    fn parse_branch_list_with_remotes() {
        let output = "\
  develop
* main
  remotes/origin/main
  remotes/origin/develop
";
        let result = parse_branch_list(output, true);
        assert_eq!(result.len(), 4);

        assert_eq!(result[2].name, "origin/main");
        assert!(result[2].is_remote);
        assert!(!result[2].is_current);
    }

    #[test]
    fn parse_branch_list_filters_remotes_when_not_included() {
        let output = "\
* main
  remotes/origin/main
";
        let result = parse_branch_list(output, false);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "main");
    }

    #[test]
    fn parse_branch_list_skips_head_pointer() {
        let output = "\
* main
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
";
        let result = parse_branch_list(output, true);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].name, "main");
        assert_eq!(result[1].name, "origin/main");
    }

    #[test]
    fn parse_branch_list_skips_detached_head() {
        let output = "\
* (HEAD detached at abc1234)
  main
";
        let result = parse_branch_list(output, false);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "main");
        assert!(!result[0].is_current);
    }

    #[test]
    fn parse_branch_list_empty() {
        let result = parse_branch_list("", false);
        assert!(result.is_empty());
    }

    #[test]
    fn validate_repo_nonexistent_path() {
        let result = validate_repo("/nonexistent/path/to/repo");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn validate_repo_file_not_directory() {
        // Use Cargo.toml as a known file that exists but is not a directory
        let result = validate_repo(env!("CARGO_MANIFEST_DIR"));
        // This should succeed since CARGO_MANIFEST_DIR is a directory
        assert!(result.is_ok());
    }

    #[test]
    fn validate_repo_valid_directory() {
        let result = validate_repo(env!("CARGO_MANIFEST_DIR"));
        assert!(result.is_ok());
    }
}
