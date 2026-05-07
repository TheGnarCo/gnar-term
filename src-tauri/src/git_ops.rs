use crate::git_helpers::{run_git, validate_git_ref, validate_repo};

#[tauri::command]
pub async fn push_branch(
    repo_path: String,
    branch: String,
    remote: Option<String>,
) -> Result<(), String> {
    validate_repo(&repo_path)?;
    let remote_name = remote.unwrap_or_else(|| "origin".to_string());
    validate_git_ref(&remote_name)?;
    validate_git_ref(&branch)?;
    run_git(&repo_path, &["push", "--", &remote_name, &branch])?;
    Ok(())
}

#[tauri::command]
pub async fn git_checkout(repo_path: String, branch: String) -> Result<(), String> {
    validate_repo(&repo_path)?;
    validate_git_ref(&branch)?;
    // Note: `git checkout -- <branch>` treats <branch> as a pathspec.
    // We omit `--` here; validate_git_ref already rejects leading-dash names
    // that would be misinterpreted as flags.
    run_git(&repo_path, &["checkout", &branch])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn setup_test_repo() -> std::path::PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("gnar-term-test-{}-{}", std::process::id(), id));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("Failed to create temp dir");

        Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .expect("Failed to git init");
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .expect("Failed to set git email");
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .output()
            .expect("Failed to set git name");

        fs::write(dir.join("README.md"), "test").expect("Failed to write file");
        Command::new("git")
            .args(["add", "."])
            .current_dir(&dir)
            .output()
            .expect("Failed to git add");
        Command::new("git")
            .args(["commit", "-m", "initial"])
            .current_dir(&dir)
            .output()
            .expect("Failed to git commit");

        dir
    }

    fn cleanup_test_repo(dir: &std::path::Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn test_push_branch_invalid_repo() {
        let result = push_branch(
            "/tmp/no-such-repo-gnarterm".to_string(),
            "main".to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    // F02 regression: injection via leading-dash branch/remote names
    #[tokio::test]
    async fn test_push_branch_rejects_injection_branch() {
        let repo = setup_test_repo();
        let result = push_branch(
            repo.to_str().unwrap().to_string(),
            "--upload-pack=malicious-cmd".to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must not start with '-'") || err.contains("invalid characters"),
            "expected injection rejection, got: {err}"
        );
        cleanup_test_repo(&repo);
    }

    #[tokio::test]
    async fn test_push_branch_rejects_injection_remote() {
        let repo = setup_test_repo();
        let result = push_branch(
            repo.to_str().unwrap().to_string(),
            "main".to_string(),
            Some("--exec=evil".to_string()),
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must not start with '-'") || err.contains("invalid characters"),
            "expected injection rejection, got: {err}"
        );
        cleanup_test_repo(&repo);
    }

    #[tokio::test]
    async fn test_git_checkout_rejects_injection() {
        let repo = setup_test_repo();
        let result = git_checkout(
            repo.to_str().unwrap().to_string(),
            "--upload-pack=malicious-cmd".to_string(),
        )
        .await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must not start with '-'") || err.contains("invalid characters"),
            "expected injection rejection, got: {err}"
        );
        cleanup_test_repo(&repo);
    }

    #[tokio::test]
    async fn test_push_branch_default_remote() {
        let repo = setup_test_repo();
        let result =
            push_branch(repo.to_str().unwrap().to_string(), "main".to_string(), None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("origin") || err.contains("remote"),
            "Expected error about origin remote, got: {err}"
        );
        cleanup_test_repo(&repo);
    }

    #[tokio::test]
    async fn test_git_checkout_invalid_repo() {
        let result =
            git_checkout("/tmp/no-such-repo-gnarterm".to_string(), "main".to_string()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_git_checkout_existing_branch() {
        let repo = setup_test_repo();
        Command::new("git")
            .args(["branch", "feature-x"])
            .current_dir(&repo)
            .output()
            .expect("Failed to create branch");

        let result =
            git_checkout(repo.to_str().unwrap().to_string(), "feature-x".to_string()).await;
        assert!(result.is_ok(), "Checkout failed: {result:?}");

        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&repo)
            .output()
            .expect("Failed to check branch");
        let current = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(current, "feature-x");

        cleanup_test_repo(&repo);
    }

    #[tokio::test]
    async fn test_git_checkout_nonexistent_branch() {
        let repo = setup_test_repo();
        let result = git_checkout(
            repo.to_str().unwrap().to_string(),
            "no-such-branch".to_string(),
        )
        .await;
        assert!(result.is_err());
        cleanup_test_repo(&repo);
    }
}
