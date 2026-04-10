use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    pub subject: String,
    pub date: String,
}

#[derive(Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status: String,
    pub staged: String,
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

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args.join(" "), stderr));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in git output: {}", e))
}

fn parse_log_output(output: &str) -> Vec<CommitInfo> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    trimmed
        .split("---\n")
        .filter(|block| !block.trim().is_empty())
        .filter_map(|block| {
            let lines: Vec<&str> = block.trim().lines().collect();
            if lines.len() < 6 {
                return None;
            }
            Some(CommitInfo {
                hash: lines[0].to_string(),
                short_hash: lines[1].to_string(),
                author_name: lines[2].to_string(),
                author_email: lines[3].to_string(),
                subject: lines[4].to_string(),
                date: lines[5].to_string(),
            })
        })
        .collect()
}

fn describe_status_char(c: char) -> String {
    match c {
        'M' => "modified".to_string(),
        'A' => "added".to_string(),
        'D' => "deleted".to_string(),
        'R' => "renamed".to_string(),
        'C' => "copied".to_string(),
        'U' => "unmerged".to_string(),
        '?' => "untracked".to_string(),
        '!' => "ignored".to_string(),
        ' ' => "unmodified".to_string(),
        other => format!("unknown({})", other),
    }
}

fn parse_status_output(output: &str) -> Vec<FileStatus> {
    if output.trim().is_empty() {
        return Vec::new();
    }

    output
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }
            let chars: Vec<char> = line.chars().collect();
            let staged_char = chars[0];
            let status_char = chars[1];
            // Porcelain format: XY followed by a space, then the path
            let path = line[3..].to_string();

            Some(FileStatus {
                path,
                staged: describe_status_char(staged_char),
                status: describe_status_char(status_char),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn git_log(
    repo_path: String,
    count: Option<u32>,
) -> Result<Vec<CommitInfo>, String> {
    validate_repo(&repo_path)?;
    let n = count.unwrap_or(20);
    let n_str = format!("-n{}", n);
    let output = run_git(
        &repo_path,
        &["log", &n_str, "--format=%H%n%h%n%an%n%ae%n%s%n%aI%n---"],
    )?;
    Ok(parse_log_output(&output))
}

#[tauri::command]
pub async fn git_status(repo_path: String) -> Result<Vec<FileStatus>, String> {
    validate_repo(&repo_path)?;
    let output = run_git(&repo_path, &["status", "--porcelain"])?;
    Ok(parse_status_output(&output))
}

#[tauri::command]
pub async fn git_diff(
    repo_path: String,
    file: Option<String>,
) -> Result<String, String> {
    validate_repo(&repo_path)?;
    match file {
        Some(ref f) => run_git(&repo_path, &["diff", "--", f]),
        None => run_git(&repo_path, &["diff"]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_parse_log_output_basic() {
        let output = "\
abc123def456abc123def456abc123def456abc123\n\
abc123d\n\
Alice Smith\n\
alice@example.com\n\
Initial commit\n\
2024-01-15T10:30:00-05:00\n\
---\n\
def789abc012def789abc012def789abc012def789\n\
def789a\n\
Bob Jones\n\
bob@example.com\n\
Add feature X\n\
2024-01-14T09:00:00-05:00\n\
---\n";

        let commits = parse_log_output(output);
        assert_eq!(commits.len(), 2);

        assert_eq!(commits[0].hash, "abc123def456abc123def456abc123def456abc123");
        assert_eq!(commits[0].short_hash, "abc123d");
        assert_eq!(commits[0].author_name, "Alice Smith");
        assert_eq!(commits[0].author_email, "alice@example.com");
        assert_eq!(commits[0].subject, "Initial commit");
        assert_eq!(commits[0].date, "2024-01-15T10:30:00-05:00");

        assert_eq!(commits[1].hash, "def789abc012def789abc012def789abc012def789");
        assert_eq!(commits[1].author_name, "Bob Jones");
        assert_eq!(commits[1].subject, "Add feature X");
    }

    #[test]
    fn test_parse_log_output_empty() {
        assert!(parse_log_output("").is_empty());
        assert!(parse_log_output("   \n  ").is_empty());
    }

    #[test]
    fn test_parse_log_output_incomplete_block() {
        let output = "hash\nshort\nauthor\n---\n";
        let commits = parse_log_output(output);
        assert!(commits.is_empty(), "Blocks with fewer than 6 lines should be skipped");
    }

    #[test]
    fn test_parse_status_output_staged_modified() {
        let output = "M  src/main.rs\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "src/main.rs");
        assert_eq!(statuses[0].staged, "modified");
        assert_eq!(statuses[0].status, "unmodified");
    }

    #[test]
    fn test_parse_status_output_unstaged_modified() {
        let output = " M src/lib.rs\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "src/lib.rs");
        assert_eq!(statuses[0].staged, "unmodified");
        assert_eq!(statuses[0].status, "modified");
    }

    #[test]
    fn test_parse_status_output_untracked() {
        let output = "?? new_file.txt\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "new_file.txt");
        assert_eq!(statuses[0].staged, "untracked");
        assert_eq!(statuses[0].status, "untracked");
    }

    #[test]
    fn test_parse_status_output_added() {
        let output = "A  new_module.rs\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].staged, "added");
        assert_eq!(statuses[0].status, "unmodified");
    }

    #[test]
    fn test_parse_status_output_deleted() {
        let output = " D removed.rs\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].staged, "unmodified");
        assert_eq!(statuses[0].status, "deleted");
    }

    #[test]
    fn test_parse_status_output_renamed() {
        let output = "R  old.rs -> new.rs\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].staged, "renamed");
        assert_eq!(statuses[0].path, "old.rs -> new.rs");
    }

    #[test]
    fn test_parse_status_output_multiple() {
        let output = "M  staged.rs\n M unstaged.rs\n?? untracked.txt\nA  added.rs\n D deleted.rs\n";
        let statuses = parse_status_output(output);
        assert_eq!(statuses.len(), 5);
        assert_eq!(statuses[0].staged, "modified");
        assert_eq!(statuses[1].status, "modified");
        assert_eq!(statuses[2].staged, "untracked");
        assert_eq!(statuses[3].staged, "added");
        assert_eq!(statuses[4].status, "deleted");
    }

    #[test]
    fn test_parse_status_output_empty() {
        assert!(parse_status_output("").is_empty());
        assert!(parse_status_output("   ").is_empty());
    }

    #[test]
    fn test_describe_status_char_all_variants() {
        assert_eq!(describe_status_char('M'), "modified");
        assert_eq!(describe_status_char('A'), "added");
        assert_eq!(describe_status_char('D'), "deleted");
        assert_eq!(describe_status_char('R'), "renamed");
        assert_eq!(describe_status_char('C'), "copied");
        assert_eq!(describe_status_char('U'), "unmerged");
        assert_eq!(describe_status_char('?'), "untracked");
        assert_eq!(describe_status_char('!'), "ignored");
        assert_eq!(describe_status_char(' '), "unmodified");
        assert!(describe_status_char('X').starts_with("unknown"));
    }

    #[test]
    fn test_validate_repo_nonexistent() {
        let result = validate_repo("/tmp/definitely_does_not_exist_gnarterm");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn test_validate_repo_not_a_directory() {
        let dir = std::env::temp_dir().join("gnarterm_test_file");
        fs::write(&dir, "test").unwrap();
        let result = validate_repo(dir.to_str().unwrap());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
        fs::remove_file(&dir).unwrap();
    }

    #[test]
    fn test_integration_git_log_on_temp_repo() {
        let dir = std::env::temp_dir().join("gnarterm_test_git_log");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // git init and create a commit
        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&dir)
            .output()
            .unwrap();

        fs::write(dir.join("file.txt"), "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "test commit"])
            .current_dir(&dir)
            .output()
            .unwrap();

        let output = run_git(
            dir.to_str().unwrap(),
            &["log", "-n1", "--format=%H%n%h%n%an%n%ae%n%s%n%aI%n---"],
        )
        .unwrap();
        let commits = parse_log_output(&output);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].author_name, "Test User");
        assert_eq!(commits[0].author_email, "test@test.com");
        assert_eq!(commits[0].subject, "test commit");
        assert!(!commits[0].hash.is_empty());
        assert!(!commits[0].date.is_empty());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_integration_git_status_on_temp_repo() {
        let dir = std::env::temp_dir().join("gnarterm_test_git_status");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&dir)
            .output()
            .unwrap();

        // Create an untracked file
        fs::write(dir.join("untracked.txt"), "hello").unwrap();

        let output = run_git(dir.to_str().unwrap(), &["status", "--porcelain"]).unwrap();
        let statuses = parse_status_output(&output);
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "untracked.txt");
        assert_eq!(statuses[0].staged, "untracked");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_integration_git_diff_on_temp_repo() {
        let dir = std::env::temp_dir().join("gnarterm_test_git_diff");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(&dir)
            .output()
            .unwrap();

        // Create, add, commit, then modify
        fs::write(dir.join("file.txt"), "original").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&dir)
            .output()
            .unwrap();

        fs::write(dir.join("file.txt"), "modified").unwrap();

        let output = run_git(dir.to_str().unwrap(), &["diff"]).unwrap();
        assert!(output.contains("original"));
        assert!(output.contains("modified"));

        // Test file-specific diff
        fs::write(dir.join("other.txt"), "other content").unwrap();
        Command::new("git")
            .args(["add", "other.txt"])
            .current_dir(&dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "add other"])
            .current_dir(&dir)
            .output()
            .unwrap();
        fs::write(dir.join("other.txt"), "changed other").unwrap();

        let file_diff = run_git(dir.to_str().unwrap(), &["diff", "--", "file.txt"]).unwrap();
        assert!(file_diff.contains("file.txt"));
        assert!(!file_diff.contains("other.txt"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_run_git_on_nonexistent_repo() {
        let result = run_git("/tmp/no_such_repo_gnarterm", &["status"]);
        assert!(result.is_err());
    }
}
