/// Typed git commands used by the git-status-service frontend.
///
/// These replace the `run_script` shell-injection surface that was
/// previously used to run `git rev-parse`, `git status`, and `gh pr view`
/// via `sh -c` with unsanitised path arguments.
///
/// Each command builds an argv array directly — no shell interpreter involved.
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use crate::file_utils::ScriptOutput;

fn validate_cwd(cwd: &str) -> Result<(), String> {
    let path = Path::new(cwd);
    if !path.exists() {
        return Err(format!("Working directory does not exist: {cwd}"));
    }
    if !path.is_dir() {
        return Err(format!("Working directory is not a directory: {cwd}"));
    }
    Ok(())
}

fn run_argv(cwd: &str, program: &str, args: &[&str]) -> Result<ScriptOutput, String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("Failed to spawn {program}: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let exit_code = output.status.code().unwrap_or(-1);
    Ok(ScriptOutput {
        stdout,
        stderr,
        exit_code,
    })
}

/// `git rev-parse --show-toplevel` — resolve the repo root from a given cwd.
///
/// Returns non-zero `exit_code` when cwd is not inside a git repo.
#[tauri::command]
pub async fn git_rev_parse_toplevel(cwd: String) -> Result<ScriptOutput, String> {
    validate_cwd(&cwd)?;
    run_argv(&cwd, "git", &["rev-parse", "--show-toplevel"])
}

/// `git status --porcelain=v1 -b` — branch + dirty-file listing.
///
/// The output is identical to what `parseGitStatus()` on the frontend expects.
#[tauri::command]
pub async fn git_status_short(cwd: String) -> Result<ScriptOutput, String> {
    validate_cwd(&cwd)?;
    run_argv(&cwd, "git", &["status", "--porcelain=v1", "-b"])
}

/// Batch variant — runs `git status --porcelain=v1 -b` for every path in
/// `cwds` concurrently (one `spawn_blocking` task per path). Paths that
/// fail validation or whose git command fails are silently omitted from the
/// returned map so callers can treat a missing key as "no result".
#[tauri::command]
pub async fn git_status_short_batch(
    cwds: Vec<String>,
) -> Result<HashMap<String, ScriptOutput>, String> {
    let handles: Vec<_> = cwds
        .into_iter()
        .map(|cwd| {
            tokio::task::spawn_blocking(move || -> Option<(String, ScriptOutput)> {
                validate_cwd(&cwd).ok()?;
                let output = run_argv(&cwd, "git", &["status", "--porcelain=v1", "-b"]).ok()?;
                Some((cwd, output))
            })
        })
        .collect();

    let mut results = HashMap::new();
    for handle in handles {
        if let Ok(Some((cwd, output))) = handle.await {
            results.insert(cwd, output);
        }
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn setup_test_repo() -> std::path::PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("gnar-term-gso-{}-{}", std::process::id(), id));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("Failed to create temp dir");

        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .expect("git init");
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .expect("git config email");
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .output()
            .expect("git config name");

        fs::write(dir.join("README.md"), "test").expect("write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&dir)
            .output()
            .expect("git add");
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&dir)
            .output()
            .expect("git commit");

        dir
    }

    fn cleanup(dir: &std::path::Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_cwd_nonexistent() {
        assert!(validate_cwd("/tmp/definitely-no-such-dir-gnarterm-gso").is_err());
    }

    #[test]
    fn validate_cwd_file_not_dir() {
        let f = std::env::temp_dir().join("gnar-term-gso-validate-file");
        fs::write(&f, "x").unwrap();
        assert!(validate_cwd(f.to_str().unwrap()).is_err());
        let _ = fs::remove_file(&f);
    }

    #[tokio::test]
    async fn git_rev_parse_toplevel_returns_repo_root() {
        let repo = setup_test_repo();
        let result = git_rev_parse_toplevel(repo.to_str().unwrap().to_string())
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(
            result
                .stdout
                .trim()
                .ends_with(repo.file_name().unwrap().to_str().unwrap())
                || result.stdout.contains(repo.to_str().unwrap())
        );
        cleanup(&repo);
    }

    #[tokio::test]
    async fn git_rev_parse_toplevel_nonexistent_cwd() {
        let result = git_rev_parse_toplevel("/tmp/no-such-repo-gnarterm-gso".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn git_status_short_clean_repo() {
        let repo = setup_test_repo();
        let result = git_status_short(repo.to_str().unwrap().to_string())
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        // Output starts with "## " branch header
        assert!(result.stdout.starts_with("## "));
        cleanup(&repo);
    }

    #[tokio::test]
    async fn git_status_short_dirty_repo() {
        let repo = setup_test_repo();
        fs::write(repo.join("dirty.txt"), "change").unwrap();
        let result = git_status_short(repo.to_str().unwrap().to_string())
            .await
            .unwrap();
        assert_eq!(result.exit_code, 0);
        assert!(result.stdout.contains("dirty.txt"));
        cleanup(&repo);
    }
}
