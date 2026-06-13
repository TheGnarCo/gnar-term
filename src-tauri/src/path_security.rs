/// String-prefix check for known-sensitive locations (SSH keys, credentials,
/// shell histories, keychains, etc.). Does NOT resolve symlinks — callers that
/// need symlink safety must also pass the canonicalized path through this check
/// (see `validate_read_path` / `file_exists`).
pub(crate) fn is_blocked_path(path_str: &str) -> bool {
    if let Ok(home) = std::env::var("HOME") {
        let blocked = [
            "/.ssh",
            "/.gnupg",
            "/.aws",
            "/.kube",
            "/.config/gcloud",
            "/.docker",
            // Additional sensitive credential / history locations
            "/.netrc",
            "/.git-credentials",
            "/.npmrc",
            "/.pypirc",
            "/.bash_history",
            "/.zsh_history",
            "/.fish/",
            // macOS user keychains
            "/Library/Keychains",
        ];
        for prefix in blocked {
            if path_str.starts_with(&format!("{}{}", home, prefix)) {
                return true;
            }
        }
    }
    path_str.starts_with("/etc/shadow")
        || path_str.starts_with("/etc/gshadow")
        // System keychains (macOS)
        || path_str.starts_with("/Library/Keychains")
        || path_str.starts_with("/System/Library/Keychains")
}

/// Block reads to sensitive directories (SSH keys, credentials, etc.).
///
/// Checks the literal path first so a non-existent but clearly-sensitive path
/// (e.g. `~/.ssh/id_rsa` on a host without that key) fails closed, then checks
/// the canonicalized path so symlinks into a blocked dir are also rejected.
pub(crate) fn validate_read_path(path: &str) -> Result<std::path::PathBuf, String> {
    if is_blocked_path(path) {
        return Err(format!("Access denied: {}", path));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Invalid path {}: {}", path, e))?;
    if is_blocked_path(&canonical.to_string_lossy()) {
        return Err(format!("Access denied: {}", path));
    }
    Ok(canonical)
}

/// Check if a file exists (lightweight — no read). Blocked paths report as
/// non-existent so callers can't probe for the presence of sensitive files
/// like `~/.ssh/id_rsa`.
#[tauri::command]
pub(crate) async fn file_exists(path: String) -> bool {
    if is_blocked_path(&path) {
        return false;
    }
    match std::fs::canonicalize(&path) {
        Ok(canonical) => !is_blocked_path(&canonical.to_string_lossy()),
        Err(_) => false,
    }
}

/// True if `path` lands in a blocked location, checking the literal path first
/// (so a sensitive-but-absent path fails closed) and then the canonicalized
/// path (so symlinks into a blocked dir are caught). Shared by the directory
/// and metadata listing commands so they enforce the same blocklist as
/// `validate_read_path`/`file_exists`.
pub(crate) fn path_is_blocked(path: &str) -> bool {
    if is_blocked_path(path) {
        return true;
    }
    match std::fs::canonicalize(path) {
        Ok(canonical) => is_blocked_path(&canonical.to_string_lossy()),
        Err(_) => false,
    }
}

/// Validate that a write path is under ~/.config/gnar-term/
pub(crate) fn validate_write_path(path: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let allowed = format!("{}/.config/gnar-term", home);

    // Manually resolve .. components to prevent traversal attacks on paths
    // that may not exist yet (canonicalize requires the path to exist).
    let mut resolved = Vec::new();
    for component in std::path::Path::new(path).components() {
        match component {
            std::path::Component::ParentDir => { resolved.pop(); }
            std::path::Component::CurDir => {}
            c => resolved.push(c),
        }
    }
    let norm_path: std::path::PathBuf = resolved.into_iter().collect();
    let norm_allowed = std::path::Path::new(&allowed).components().collect::<std::path::PathBuf>();

    if !norm_path.starts_with(&norm_allowed) {
        return Err(format!("Write denied: path must be under {}", allowed));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Security: path validation (S4-S6)
    // -----------------------------------------------------------------------

    #[test]
    fn validate_read_path_allows_normal_files() {
        // /etc/hosts exists on all unix systems and is not blocked
        let result = validate_read_path("/etc/hosts");
        assert!(result.is_ok(), "Should allow reading /etc/hosts: {:?}", result);
    }

    #[test]
    fn validate_read_path_blocks_ssh_dir() {
        let home = std::env::var("HOME").unwrap();
        let ssh_key = format!("{}/.ssh/id_rsa", home);
        let result = validate_read_path(&ssh_key);
        assert!(result.is_err(), "Should block reading ~/.ssh/id_rsa");
        assert!(result.unwrap_err().contains("Access denied"));
    }

    #[test]
    fn validate_read_path_blocks_gnupg_dir() {
        let home = std::env::var("HOME").unwrap();
        let gpg = format!("{}/.gnupg/trustdb.gpg", home);
        let result = validate_read_path(&gpg);
        // Rejected either because dir doesn't exist (canonicalize fails)
        // or because it's in the blocklist — both are safe outcomes
        assert!(result.is_err(), "Should block reading ~/.gnupg/");
    }

    #[test]
    fn validate_read_path_blocks_aws_credentials() {
        let home = std::env::var("HOME").unwrap();
        let aws = format!("{}/.aws/credentials", home);
        let result = validate_read_path(&aws);
        assert!(result.is_err(), "Should block reading ~/.aws/credentials");
    }

    #[test]
    fn validate_read_path_rejects_nonexistent_file() {
        let result = validate_read_path("/nonexistent/path/to/file.txt");
        assert!(result.is_err(), "Should reject nonexistent paths");
    }

    #[test]
    fn validate_read_path_fails_closed_on_nonexistent_ssh_key() {
        // A sensitive path must be denied even when it doesn't exist on this
        // host — the literal check fires before canonicalize.
        let home = std::env::var("HOME").unwrap();
        let p = format!("{}/.ssh/id_rsa", home);
        assert!(
            validate_read_path(&p).is_err(),
            "Should fail closed on ~/.ssh/id_rsa even if absent"
        );
    }

    #[test]
    fn validate_read_path_blocks_extended_credential_files() {
        let home = std::env::var("HOME").unwrap();
        for rel in [
            "/.netrc",
            "/.git-credentials",
            "/.npmrc",
            "/.pypirc",
            "/.bash_history",
            "/.zsh_history",
            "/.fish/fish_history",
            "/Library/Keychains/login.keychain-db",
        ] {
            let p = format!("{}{}", home, rel);
            assert!(validate_read_path(&p).is_err(), "Should block {}", rel);
        }
    }

    #[test]
    fn is_blocked_path_flags_system_keychains() {
        assert!(is_blocked_path("/Library/Keychains/System.keychain"));
        assert!(is_blocked_path("/System/Library/Keychains/foo"));
        assert!(!is_blocked_path("/Users/someone/projects/main.rs"));
    }

    #[tokio::test]
    async fn file_exists_hides_sensitive_paths() {
        let home = std::env::var("HOME").unwrap();
        let ssh = format!("{}/.ssh/id_rsa", home);
        assert!(
            !file_exists(ssh).await,
            "file_exists must not leak presence of ~/.ssh/id_rsa"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_exists_rejects_symlink_into_blocked_dir() {
        use std::fs;
        let home = std::env::var("HOME").unwrap();
        let blocked_target = format!("{}/.ssh", home);
        // Only meaningful when the target actually exists on this host.
        if !std::path::Path::new(&blocked_target).exists() {
            return;
        }
        let tmp = std::env::temp_dir().join("gnar_file_exists_symlink_test");
        let _ = fs::remove_file(&tmp);
        std::os::unix::fs::symlink(&blocked_target, &tmp).expect("create test symlink");
        let result = file_exists(tmp.to_string_lossy().to_string()).await;
        let _ = fs::remove_file(&tmp);
        assert!(!result, "symlinks into ~/.ssh must be rejected");
    }

    #[test]
    fn validate_write_path_allows_config_dir() {
        let home = std::env::var("HOME").unwrap();
        let config = format!("{}/.config/gnar-term/gnar-term.json", home);
        let result = validate_write_path(&config);
        assert!(result.is_ok(), "Should allow writing to ~/.config/gnar-term/: {:?}", result);
    }

    #[test]
    fn validate_write_path_blocks_home_dir() {
        let home = std::env::var("HOME").unwrap();
        let path = format!("{}/.bashrc", home);
        let result = validate_write_path(&path);
        assert!(result.is_err(), "Should block writing to ~/.bashrc");
        assert!(result.unwrap_err().contains("Write denied"));
    }

    #[test]
    fn validate_write_path_blocks_system_paths() {
        let result = validate_write_path("/etc/passwd");
        assert!(result.is_err(), "Should block writing to /etc/passwd");
    }

    #[test]
    fn validate_write_path_blocks_traversal() {
        let home = std::env::var("HOME").unwrap();
        let traversal = format!("{}/.config/gnar-term/../../.bashrc", home);
        let result = validate_write_path(&traversal);
        assert!(result.is_err(), "Should block path traversal via ../");
    }

    #[test]
    fn validate_write_path_allows_nested_config() {
        let home = std::env::var("HOME").unwrap();
        let nested = format!("{}/.config/gnar-term/themes/custom.json", home);
        let result = validate_write_path(&nested);
        assert!(result.is_ok(), "Should allow nested paths under config dir: {:?}", result);
    }
}
