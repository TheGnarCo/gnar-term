//! Shared git argument validation helpers.
//!
//! Used by `git_ops` and `git_worktree` to prevent argument injection when
//! passing user-controlled branch/remote names to git.

/// Validate that a string is safe to use as a git ref name (branch, remote, base, etc.).
///
/// Rejects strings that could cause git to interpret the argument as a flag or
/// execute arbitrary commands:
/// - Names starting with `-` (would be parsed as a flag, e.g. `--upload-pack=...`)
/// - Names containing `..` (git double-dot range syntax / path traversal)
/// - Names containing null bytes
/// - Empty strings
pub fn validate_git_ref(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("git ref name must not be empty".to_string());
    }
    if name.starts_with('-') {
        return Err(format!("git ref name must not start with '-': {name:?}"));
    }
    if name.contains("..") {
        return Err(format!("git ref name must not contain '..': {name:?}"));
    }
    if name.contains('\0') {
        return Err(format!(
            "git ref name must not contain null bytes: {name:?}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_refs_pass() {
        assert!(validate_git_ref("main").is_ok());
        assert!(validate_git_ref("feature/foo-bar").is_ok());
        assert!(validate_git_ref("origin").is_ok());
        assert!(validate_git_ref("v1.2.3").is_ok());
        assert!(validate_git_ref("HEAD~1").is_ok());
    }

    #[test]
    fn empty_ref_rejected() {
        assert!(validate_git_ref("").is_err());
    }

    #[test]
    fn leading_dash_rejected() {
        assert!(validate_git_ref("-bad").is_err());
        assert!(validate_git_ref("--upload-pack=malicious-cmd").is_err());
        assert!(validate_git_ref("--exec=evil").is_err());
    }

    #[test]
    fn double_dot_rejected() {
        assert!(validate_git_ref("main..feature").is_err());
        assert!(validate_git_ref("../secret").is_err());
        assert!(validate_git_ref("refs/heads/..hidden").is_err());
    }

    #[test]
    fn null_byte_rejected() {
        assert!(validate_git_ref("main\0evil").is_err());
    }
}
