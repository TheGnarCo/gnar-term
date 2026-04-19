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
}
