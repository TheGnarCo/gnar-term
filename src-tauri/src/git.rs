use serde::{Deserialize, Serialize};
use tokio::process::Command;

/// Run a git command and return stdout, or an error string.
/// If `cwd` is `Some`, the command runs in that directory; otherwise it inherits
/// the process working directory (needed for commands like `git clone` that create
/// the target directory).
async fn run_git(args: &[&str], cwd: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(stderr.trim().to_string())
    }
}

// ---- Clone ----

/// Clone a git repository
#[tauri::command]
pub async fn git_clone(url: String, target_dir: String) -> Result<(), String> {
    run_git(&["clone", &url, &target_dir], None).await?;
    Ok(())
}

// ---- Worktree operations ----

/// Info about a git worktree
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_bare: bool,
}

/// Parse `git worktree list --porcelain` output into WorktreeInfo structs
pub fn parse_worktree_list(output: &str) -> Vec<WorktreeInfo> {
    let mut result = Vec::new();
    let mut path = String::new();
    let mut head = String::new();
    let mut branch = String::new();
    let mut is_bare = false;

    for line in output.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if !path.is_empty() {
                result.push(WorktreeInfo {
                    path: path.clone(),
                    branch: branch.clone(),
                    head: head.clone(),
                    is_bare,
                });
            }
            path = p.to_string();
            head.clear();
            branch.clear();
            is_bare = false;
        } else if let Some(h) = line.strip_prefix("HEAD ") {
            head = h.to_string();
        } else if let Some(b) = line.strip_prefix("branch ") {
            branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            branch = "(detached)".to_string();
        }
    }
    if !path.is_empty() {
        result.push(WorktreeInfo { path, branch, head, is_bare });
    }
    result
}

/// Create a new git worktree. Returns the worktree path.
///
/// `worktree_base_dir` controls placement:
/// - "siblings" (default): <repo-parent>/<repo-name>-worktrees/<branch>/
/// - "nested": <repo>/.worktrees/<branch>/
/// - Any other string: treated as an absolute base path
#[tauri::command]
pub async fn create_worktree(repo_path: String, branch: String, base: String, worktree_base_dir: Option<String>) -> Result<String, String> {
    if branch.starts_with('-') {
        return Err("Invalid branch name".into());
    }
    if base.starts_with('-') {
        return Err("Invalid base branch name".into());
    }

    let repo = std::path::Path::new(&repo_path);
    let strategy = worktree_base_dir.as_deref().unwrap_or("nested");

    let dir_name = branch.replace('/', std::path::MAIN_SEPARATOR_STR);

    let worktree_path = match strategy {
        // flat-siblings (default): worktrees are direct siblings of the repo
        // /path/project/main + branch "feat-x" -> /path/project/feat-x
        "flat-siblings" => {
            let parent = repo.parent().ok_or("Cannot determine parent directory")?;
            parent.join(&dir_name)
        }
        // siblings: worktrees in a <repo>-worktrees/ subdirectory
        "siblings" => {
            let parent = repo.parent().ok_or("Cannot determine parent directory")?;
            let repo_name = repo.file_name()
                .and_then(|n| n.to_str())
                .ok_or("Cannot determine repo name")?;
            parent.join(format!("{}-worktrees", repo_name)).join(&dir_name)
        }
        // nested: worktrees inside the repo
        "nested" => repo.join(".worktrees").join(&dir_name),
        // custom absolute path
        custom => std::path::PathBuf::from(custom).join(&dir_name),
    };
    let worktree_str = worktree_path.to_str().ok_or("Invalid worktree path")?;

    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create worktree directory: {}", e))?;
    }

    // Check if the branch already exists locally
    let branch_exists = run_git(&["branch", "--list", &branch], Some(&repo_path))
        .await
        .map(|out| !out.trim().is_empty())
        .unwrap_or(false);

    if branch_exists {
        run_git(
            &["worktree", "add", worktree_str, &branch],
            Some(&repo_path),
        ).await?;
    } else {
        run_git(
            &["worktree", "add", "-b", &branch, worktree_str, &base],
            Some(&repo_path),
        ).await?;
    }

    Ok(worktree_str.to_string())
}

/// Checkout a branch (creates local tracking branch from remote if needed)
#[tauri::command]
pub async fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    if branch.starts_with('-') {
        return Err("Invalid branch name".into());
    }
    run_git(&["checkout", &branch], Some(&repo_path)).await?;
    Ok(())
}

/// Remove a git worktree
#[tauri::command]
pub async fn remove_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    run_git(&["worktree", "remove", &worktree_path, "--force"], Some(&repo_path)).await?;
    Ok(())
}

/// List all worktrees for a repository
#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let output = run_git(&["worktree", "list", "--porcelain"], Some(&repo_path)).await?;
    Ok(parse_worktree_list(&output))
}

// ---- Branch operations ----

/// Info about a git branch
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub head: String,
}

/// Parse `git branch -a --format=...` output
pub fn parse_branch_list(output: &str) -> Vec<BranchInfo> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                return None;
            }
            let refname = parts[0];
            let head = parts[1].to_string();
            let is_current = parts[2] == "*";

            let (name, is_remote) = if let Some(remote_name) = refname.strip_prefix("refs/remotes/") {
                if remote_name.ends_with("/HEAD") {
                    return None;
                }
                (remote_name.to_string(), true)
            } else if let Some(local_name) = refname.strip_prefix("refs/heads/") {
                (local_name.to_string(), false)
            } else {
                return None;
            };

            Some(BranchInfo { name, is_current, is_remote, head })
        })
        .collect()
}

/// Fetch all remotes
#[tauri::command]
pub async fn git_fetch_all(repo_path: String) -> Result<(), String> {
    run_git(&["fetch", "--all"], Some(&repo_path)).await?;
    Ok(())
}

/// List branches (local, or local + remote)
#[tauri::command]
pub async fn list_branches(repo_path: String, include_remote: bool) -> Result<Vec<BranchInfo>, String> {
    let mut args = vec![
        "branch",
        "--format=%(refname)\t%(objectname:short)\t%(HEAD)",
    ];
    if include_remote {
        args.push("-a");
    }
    let output = run_git(&args, Some(&repo_path)).await?;
    Ok(parse_branch_list(&output))
}

/// Push a branch to origin
#[tauri::command]
pub async fn push_branch(repo_path: String, branch: String) -> Result<(), String> {
    if branch.starts_with('-') {
        return Err("Invalid branch name".into());
    }
    run_git(&["push", "origin", &branch], Some(&repo_path)).await?;
    Ok(())
}

/// Delete a branch (local, or remote via --remote flag)
#[tauri::command]
pub async fn delete_branch(repo_path: String, branch: String, remote: bool) -> Result<(), String> {
    if branch.starts_with('-') {
        return Err("Invalid branch name".into());
    }
    if remote {
        run_git(&["push", "origin", "--delete", &branch], Some(&repo_path)).await?;
    } else {
        run_git(&["branch", "-D", &branch], Some(&repo_path)).await?;
    }
    Ok(())
}

// ---- Diff / status / log ----

/// A file's status in the working tree
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub index_status: String,
    pub work_status: String,
}

/// A commit in the log
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
}

/// Parse `git status --porcelain=v1` output
pub fn parse_git_status(output: &str) -> Vec<FileStatus> {
    output
        .lines()
        .filter(|line| line.len() >= 4)
        .map(|line| {
            let index_status = line[0..1].to_string();
            let work_status = line[1..2].to_string();
            let path = line[3..].to_string();
            FileStatus { path, index_status, work_status }
        })
        .collect()
}

/// Parse `git log --format=...` output
pub fn parse_git_log(output: &str) -> Vec<CommitInfo> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\x00').collect();
            if parts.len() < 5 {
                return None;
            }
            Some(CommitInfo {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                subject: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            })
        })
        .collect()
}

/// Get working tree status (staged + unstaged changes)
#[tauri::command]
pub async fn git_status(worktree_path: String) -> Result<Vec<FileStatus>, String> {
    let output = run_git(&["status", "--porcelain=v1"], Some(&worktree_path)).await?;
    Ok(parse_git_status(&output))
}

/// Get diff output (full working tree, or a specific file/commit)
#[tauri::command]
pub async fn git_diff(worktree_path: String, path: Option<String>) -> Result<String, String> {
    let mut args = vec!["diff"];
    if let Some(ref p) = path {
        args.push("--");
        args.push(p);
    }
    run_git(&args, Some(&worktree_path)).await
}

/// Get commit log (all commits, or only those ahead of a base branch)
#[tauri::command]
pub async fn git_log(worktree_path: String, base_branch: Option<String>) -> Result<Vec<CommitInfo>, String> {
    let format_str = "--format=%H\x00%h\x00%s\x00%an\x00%ai";
    let range;
    let args = if let Some(ref base) = base_branch {
        if base.starts_with('-') {
            return Err(format!("Invalid base branch name: {}", base));
        }
        range = format!("{}..HEAD", base);
        vec!["log", format_str, &range]
    } else {
        vec!["log", format_str, "-50"]
    };
    let output = run_git(&args, Some(&worktree_path)).await?;
    Ok(parse_git_log(&output))
}

/// List tracked files in a worktree (git ls-files)
#[tauri::command]
pub async fn git_ls_files(worktree_path: String) -> Result<Vec<String>, String> {
    let output = run_git(&["ls-files"], Some(&worktree_path)).await?;
    Ok(output.lines().filter(|l| !l.is_empty()).map(String::from).collect())
}

// ---- GitHub CLI integration ----

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhIssue {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub author: String,
    pub labels: Vec<String>,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Intermediate struct for deserializing gh issue JSON output.
#[derive(Deserialize)]
struct GhIssueRaw {
    number: i64,
    title: String,
    state: String,
    author: GhAuthor,
    labels: Vec<GhLabel>,
    url: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

#[derive(Deserialize)]
struct GhAuthor {
    login: String,
}

#[derive(Deserialize)]
struct GhLabel {
    name: String,
}

/// List GitHub issues for a repo using the gh CLI.
/// `repo_path` is used as the working directory so gh can detect the repo.
#[tauri::command]
pub async fn gh_list_issues(repo_path: String, state: Option<String>) -> Result<Vec<GhIssue>, String> {
    let state_arg = state.unwrap_or_else(|| "open".to_string());
    let output = Command::new("gh")
        .args([
            "issue", "list",
            "--state", &state_arg,
            "--limit", "50",
            "--json", "number,title,state,author,labels,url,createdAt,updatedAt",
        ])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(stderr.trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<GhIssueRaw> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse gh output: {}", e))?;

    Ok(raw.into_iter().map(|r| GhIssue {
        number: r.number,
        title: r.title,
        state: r.state,
        author: r.author.login,
        labels: r.labels.into_iter().map(|l| l.name).collect(),
        url: r.url,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }).collect())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhPullRequest {
    pub number: i64,
    pub title: String,
    pub state: String,
    pub author: String,
    pub head_ref: String,
    pub labels: Vec<String>,
    pub url: String,
    pub is_draft: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Intermediate struct for deserializing gh PR JSON output.
#[derive(Deserialize)]
struct GhPrRaw {
    number: i64,
    title: String,
    state: String,
    author: GhAuthor,
    #[serde(rename = "headRefName")]
    head_ref: String,
    labels: Vec<GhLabel>,
    url: String,
    #[serde(rename = "isDraft")]
    is_draft: bool,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
}

/// List GitHub pull requests for a repo using the gh CLI.
#[tauri::command]
pub async fn gh_list_prs(repo_path: String, state: Option<String>) -> Result<Vec<GhPullRequest>, String> {
    let state_arg = state.unwrap_or_else(|| "open".to_string());
    let output = Command::new("gh")
        .args([
            "pr", "list",
            "--state", &state_arg,
            "--limit", "50",
            "--json", "number,title,state,author,headRefName,labels,url,isDraft,createdAt,updatedAt",
        ])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(stderr.trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<GhPrRaw> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse gh output: {}", e))?;

    Ok(raw.into_iter().map(|r| GhPullRequest {
        number: r.number,
        title: r.title,
        state: r.state,
        author: r.author.login,
        head_ref: r.head_ref,
        labels: r.labels.into_iter().map(|l| l.name).collect(),
        url: r.url,
        is_draft: r.is_draft,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }).collect())
}

// ---- PR workflow commands ----

/// Stage files. Empty paths = `git add -A`, otherwise `git add -- <paths>`.
#[tauri::command]
pub async fn git_add(worktree_path: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        run_git(&["add", "-A"], Some(&worktree_path)).await?;
    } else {
        let mut args = vec!["add", "--"];
        let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(path_refs);
        run_git(&args, Some(&worktree_path)).await?;
    }
    Ok(())
}

/// Commit staged changes. Returns the short hash of the new commit.
#[tauri::command]
pub async fn git_commit(worktree_path: String, message: String) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    run_git(&["commit", "-m", trimmed], Some(&worktree_path)).await?;
    let hash = run_git(&["rev-parse", "--short", "HEAD"], Some(&worktree_path)).await?;
    Ok(hash.trim().to_string())
}

/// Push the current branch to origin with upstream tracking.
#[tauri::command]
pub async fn git_push(worktree_path: String) -> Result<String, String> {
    let branch = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&worktree_path)).await?;
    let branch = branch.trim();
    run_git(&["push", "-u", "origin", branch], Some(&worktree_path)).await?;
    Ok(branch.to_string())
}

/// Pull with rebase from the remote tracking branch.
#[tauri::command]
pub async fn git_pull(worktree_path: String) -> Result<String, String> {
    run_git(&["pull", "--rebase"], Some(&worktree_path)).await
}

/// Get ahead/behind counts relative to a remote tracking branch.
/// Returns a string like "3\t1\n" (ahead\tbehind).
#[tauri::command]
pub async fn git_rev_list_count(
    worktree_path: String,
    branch: String,
    remote_branch: String,
) -> Result<String, String> {
    let range = format!("{}...{}", branch, remote_branch);
    run_git(&["rev-list", "--left-right", "--count", &range], Some(&worktree_path)).await
}

/// Get the current branch name.
#[tauri::command]
pub async fn git_branch_name(worktree_path: String) -> Result<String, String> {
    let name = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(&worktree_path)).await?;
    Ok(name.trim().to_string())
}

/// Get the staged diff (`git diff --cached`).
#[tauri::command]
pub async fn git_diff_staged(worktree_path: String) -> Result<String, String> {
    run_git(&["diff", "--cached"], Some(&worktree_path)).await
}

/// Create a GitHub pull request via the `gh` CLI. Returns the PR URL.
#[tauri::command]
pub async fn gh_create_pr(
    repo_path: String,
    title: String,
    body: Option<String>,
    base: Option<String>,
    draft: bool,
) -> Result<String, String> {
    let mut args = vec!["pr", "create", "--title", &title];

    let body_val;
    if let Some(ref b) = body {
        body_val = b.clone();
        args.push("--body");
        args.push(&body_val);
    }

    let base_val;
    if let Some(ref b) = base {
        base_val = b.clone();
        args.push("--base");
        args.push(&base_val);
    }

    if draft {
        args.push("--draft");
    }

    let output = Command::new("gh")
        .args(&args)
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run gh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(stderr.trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout.trim().to_string())
}

// ---- Worktree lifecycle commands ----

/// Run a shell command in a given directory. Returns stdout.
///
/// SECURITY: This command is equivalent to shell access. Only call from trusted
/// frontend paths. The `cwd` must be a non-empty absolute path.
#[tauri::command]
pub async fn run_script(cwd: String, command: String) -> Result<String, String> {
    if command.trim().is_empty() {
        return Ok(String::new());
    }
    if cwd.is_empty() || !cwd.starts_with('/') {
        return Err("cwd must be a non-empty absolute path".into());
    }
    let output = Command::new("sh")
        .args(["-c", &command])
        .current_dir(&cwd)
        .output()
        .await
        .map_err(|e| format!("Failed to run script: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("Script failed: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Copy files matching glob patterns from source to destination directory.
/// Preserves relative paths.
#[tauri::command]
pub async fn copy_files(source_dir: String, dest_dir: String, patterns: Vec<String>) -> Result<Vec<String>, String> {
    if !dest_dir.starts_with('/') || !std::path::Path::new(&dest_dir).exists() {
        return Err("dest_dir must be an existing absolute path".into());
    }

    let mut copied = Vec::new();
    let src = std::path::Path::new(&source_dir);
    let dst = std::path::Path::new(&dest_dir);

    for pattern in &patterns {
        let full_pattern = src.join(pattern);
        let full_str = full_pattern.to_str().ok_or("Invalid pattern path")?;
        let entries = glob::glob(full_str).map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?;
        for entry in entries.flatten() {
            if entry.is_file() {
                // Validate the source file is readable (not in a blocked directory)
                let entry_str = entry.to_string_lossy();
                if crate::fs::validate_read_path(&entry_str).is_err() {
                    continue;
                }
                let rel = entry.strip_prefix(src).map_err(|e| e.to_string())?;
                let dest_path = dst.join(rel);
                if let Some(parent) = dest_path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create dir: {}", e))?;
                }
                std::fs::copy(&entry, &dest_path)
                    .map_err(|e| format!("Failed to copy {}: {}", rel.display(), e))?;
                copied.push(rel.to_string_lossy().to_string());
            }
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_commit_rejects_empty_message() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(git_commit("/nonexistent".to_string(), "".to_string()));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Commit message cannot be empty");
    }

    #[test]
    fn git_commit_rejects_whitespace_only_message() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(git_commit("/nonexistent".to_string(), "   \n  ".to_string()));
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Commit message cannot be empty");
    }
}
