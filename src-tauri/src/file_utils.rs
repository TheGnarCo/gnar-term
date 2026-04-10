use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Serialize)]
pub struct ScriptOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Match a glob pattern against a path string.
///
/// Supports:
/// - `*` matches any characters except `/`
/// - `**` matches any number of path segments (including zero)
/// - All other characters match literally
pub fn matches_glob(pattern: &str, path: &str) -> bool {
    let pat_parts: Vec<&str> = pattern.split('/').collect();
    let path_parts: Vec<&str> = path.split('/').collect();
    matches_glob_parts(&pat_parts, &path_parts)
}

fn matches_glob_parts(pat_parts: &[&str], path_parts: &[&str]) -> bool {
    if pat_parts.is_empty() {
        return path_parts.is_empty();
    }

    let pat = pat_parts[0];

    if pat == "**" {
        // `**` can match zero or more path segments
        // Try matching the rest of the pattern against every suffix of path_parts
        for i in 0..=path_parts.len() {
            if matches_glob_parts(&pat_parts[1..], &path_parts[i..]) {
                return true;
            }
        }
        return false;
    }

    if path_parts.is_empty() {
        return false;
    }

    if matches_segment(pat, path_parts[0]) {
        matches_glob_parts(&pat_parts[1..], &path_parts[1..])
    } else {
        false
    }
}

/// Match a single path segment against a pattern segment containing `*` wildcards.
fn matches_segment(pattern: &str, segment: &str) -> bool {
    // Split pattern on `*` to get literal parts that must appear in order
    let parts: Vec<&str> = pattern.split('*').collect();

    if parts.len() == 1 {
        // No wildcard — exact match
        return pattern == segment;
    }

    let seg = segment.as_bytes();
    let mut pos = 0;

    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        let part_bytes = part.as_bytes();

        if i == 0 {
            // First part must match at the start
            if !seg[pos..].starts_with(part_bytes) {
                return false;
            }
            pos += part_bytes.len();
        } else if i == parts.len() - 1 {
            // Last part must match at the end
            if seg.len() < part_bytes.len() || !seg[seg.len() - part_bytes.len()..].starts_with(part_bytes) {
                return false;
            }
            pos = seg.len();
        } else {
            // Middle parts: find next occurrence
            match find_subsequence(&seg[pos..], part_bytes) {
                Some(offset) => pos += offset + part_bytes.len(),
                None => return false,
            }
        }
    }

    true
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Recursively collect all files under `dir`, returning paths relative to `base`.
fn collect_files(dir: &Path, base: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_files_recursive(dir, base, &mut files);
    files
}

fn collect_files_recursive(dir: &Path, base: &Path, files: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, base, files);
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(base) {
                files.push(rel.to_path_buf());
            }
        }
    }
}

#[tauri::command]
pub async fn copy_files(
    source_dir: String,
    dest_dir: String,
    patterns: Vec<String>,
) -> Result<u32, String> {
    let source = Path::new(&source_dir);
    if !source.exists() {
        return Err(format!("Source directory does not exist: {}", source_dir));
    }
    if !source.is_dir() {
        return Err(format!("Source path is not a directory: {}", source_dir));
    }

    let dest = Path::new(&dest_dir);
    let all_files = collect_files(source, source);
    let mut copied: u32 = 0;

    for rel_path in &all_files {
        let rel_str = rel_path.to_string_lossy();
        // Normalize to forward slashes for glob matching
        let rel_normalized = rel_str.replace('\\', "/");

        let matched = patterns.iter().any(|pat| matches_glob(pat, &rel_normalized));
        if !matched {
            continue;
        }

        let src_file = source.join(rel_path);
        let dest_file = dest.join(rel_path);

        if let Some(parent) = dest_file.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create directory {}: {}", parent.display(), e)
            })?;
        }

        fs::copy(&src_file, &dest_file).map_err(|e| {
            format!(
                "Failed to copy {} to {}: {}",
                src_file.display(),
                dest_file.display(),
                e
            )
        })?;
        copied += 1;
    }

    Ok(copied)
}

#[tauri::command]
pub async fn run_script(cwd: String, command: String) -> Result<ScriptOutput, String> {
    let dir = Path::new(&cwd);
    if !dir.exists() {
        return Err(format!("Working directory does not exist: {}", cwd));
    }
    if !dir.is_dir() {
        return Err(format!("Path is not a directory: {}", cwd));
    }

    let output = Command::new("sh")
        .arg("-c")
        .arg(&command)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(ScriptOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ─── matches_glob tests ─────────────────────────────────────────

    #[test]
    fn glob_exact_match() {
        assert!(matches_glob("foo.txt", "foo.txt"));
        assert!(!matches_glob("foo.txt", "bar.txt"));
    }

    #[test]
    fn glob_star_matches_extension() {
        assert!(matches_glob("*.txt", "hello.txt"));
        assert!(matches_glob("*.txt", "world.txt"));
        assert!(!matches_glob("*.txt", "hello.rs"));
        assert!(!matches_glob("*.txt", "sub/hello.txt"));
    }

    #[test]
    fn glob_star_in_middle() {
        assert!(matches_glob("test_*.rs", "test_foo.rs"));
        assert!(matches_glob("test_*.rs", "test_bar.rs"));
        assert!(!matches_glob("test_*.rs", "test_bar.txt"));
        assert!(!matches_glob("test_*.rs", "best_bar.rs"));
    }

    #[test]
    fn glob_star_does_not_cross_directories() {
        assert!(!matches_glob("*.rs", "sub/foo.rs"));
    }

    #[test]
    fn glob_doublestar_matches_any_depth() {
        assert!(matches_glob("**/*.rs", "foo.rs"));
        assert!(matches_glob("**/*.rs", "src/foo.rs"));
        assert!(matches_glob("**/*.rs", "src/sub/foo.rs"));
        assert!(!matches_glob("**/*.rs", "src/foo.txt"));
    }

    #[test]
    fn glob_doublestar_prefix() {
        assert!(matches_glob("src/**/*.rs", "src/main.rs"));
        assert!(matches_glob("src/**/*.rs", "src/sub/mod.rs"));
        assert!(!matches_glob("src/**/*.rs", "lib/foo.rs"));
    }

    #[test]
    fn glob_doublestar_only() {
        // `**` alone should match everything
        assert!(matches_glob("**", "anything"));
        assert!(matches_glob("**", "a/b/c"));
    }

    #[test]
    fn glob_directory_and_star() {
        assert!(matches_glob("src/*.rs", "src/main.rs"));
        assert!(!matches_glob("src/*.rs", "src/sub/main.rs"));
        assert!(!matches_glob("src/*.rs", "lib/main.rs"));
    }

    #[test]
    fn glob_multiple_stars_in_segment() {
        assert!(matches_glob("*_test_*.rs", "my_test_file.rs"));
        assert!(!matches_glob("*_test_*.rs", "my_test_file.txt"));
    }

    // ─── copy_files tests ───────────────────────────────────────────

    #[tokio::test]
    async fn copy_files_basic() {
        let tmp = tempdir();
        let src = tmp.join("src");
        let dst = tmp.join("dst");

        // Create source structure
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.txt"), "aaa").unwrap();
        fs::write(src.join("b.rs"), "bbb").unwrap();
        fs::write(src.join("sub/c.txt"), "ccc").unwrap();

        let count = copy_files(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
            vec!["*.txt".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(count, 1); // only a.txt, not sub/c.txt
        assert!(dst.join("a.txt").exists());
        assert!(!dst.join("b.rs").exists());
        assert!(!dst.join("sub/c.txt").exists());
    }

    #[tokio::test]
    async fn copy_files_doublestar_pattern() {
        let tmp = tempdir();
        let src = tmp.join("src");
        let dst = tmp.join("dst");

        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.txt"), "aaa").unwrap();
        fs::write(src.join("sub/b.txt"), "bbb").unwrap();
        fs::write(src.join("sub/c.rs"), "ccc").unwrap();

        let count = copy_files(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
            vec!["**/*.txt".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(count, 2);
        assert!(dst.join("a.txt").exists());
        assert!(dst.join("sub/b.txt").exists());
        assert_eq!(fs::read_to_string(dst.join("sub/b.txt")).unwrap(), "bbb");
    }

    #[tokio::test]
    async fn copy_files_preserves_directory_structure() {
        let tmp = tempdir();
        let src = tmp.join("src");
        let dst = tmp.join("dst");

        fs::create_dir_all(src.join("deep/nested")).unwrap();
        fs::write(src.join("deep/nested/file.rs"), "content").unwrap();

        let count = copy_files(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
            vec!["**/*.rs".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(count, 1);
        assert_eq!(
            fs::read_to_string(dst.join("deep/nested/file.rs")).unwrap(),
            "content"
        );
    }

    #[tokio::test]
    async fn copy_files_multiple_patterns() {
        let tmp = tempdir();
        let src = tmp.join("src");
        let dst = tmp.join("dst");

        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("a.txt"), "a").unwrap();
        fs::write(src.join("b.rs"), "b").unwrap();
        fs::write(src.join("c.json"), "c").unwrap();

        let count = copy_files(
            src.to_string_lossy().to_string(),
            dst.to_string_lossy().to_string(),
            vec!["*.txt".to_string(), "*.rs".to_string()],
        )
        .await
        .unwrap();

        assert_eq!(count, 2);
        assert!(dst.join("a.txt").exists());
        assert!(dst.join("b.rs").exists());
        assert!(!dst.join("c.json").exists());
    }

    #[tokio::test]
    async fn copy_files_nonexistent_source() {
        let result = copy_files(
            "/nonexistent/path/12345".to_string(),
            "/tmp/dst".to_string(),
            vec!["*.txt".to_string()],
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[tokio::test]
    async fn copy_files_source_is_file() {
        let tmp = tempdir();
        let file = tmp.join("not_a_dir.txt");
        fs::write(&file, "hello").unwrap();

        let result = copy_files(
            file.to_string_lossy().to_string(),
            tmp.join("dst").to_string_lossy().to_string(),
            vec!["*".to_string()],
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    // ─── run_script tests ───────────────────────────────────────────

    #[tokio::test]
    async fn run_script_echo() {
        let tmp = tempdir();
        fs::create_dir_all(&tmp).unwrap();

        let result = run_script(
            tmp.to_string_lossy().to_string(),
            "echo hello".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.stdout.trim(), "hello");
        assert_eq!(result.exit_code, 0);
    }

    #[tokio::test]
    async fn run_script_pwd() {
        let tmp = tempdir();
        fs::create_dir_all(&tmp).unwrap();

        let result = run_script(
            tmp.to_string_lossy().to_string(),
            "pwd".to_string(),
        )
        .await
        .unwrap();

        // Resolve symlinks for macOS /private/var/folders vs /var/folders
        let expected = fs::canonicalize(&tmp).unwrap();
        let actual = PathBuf::from(result.stdout.trim());
        let actual_canon = fs::canonicalize(&actual).unwrap_or(actual);
        assert_eq!(actual_canon, expected);
        assert_eq!(result.exit_code, 0);
    }

    #[tokio::test]
    async fn run_script_captures_stderr() {
        let tmp = tempdir();
        fs::create_dir_all(&tmp).unwrap();

        let result = run_script(
            tmp.to_string_lossy().to_string(),
            "echo error >&2".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.stderr.trim(), "error");
        assert_eq!(result.exit_code, 0);
    }

    #[tokio::test]
    async fn run_script_nonzero_exit() {
        let tmp = tempdir();
        fs::create_dir_all(&tmp).unwrap();

        let result = run_script(
            tmp.to_string_lossy().to_string(),
            "exit 42".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.exit_code, 42);
    }

    #[tokio::test]
    async fn run_script_nonexistent_cwd() {
        let result = run_script(
            "/nonexistent/path/12345".to_string(),
            "echo hello".to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[tokio::test]
    async fn run_script_cwd_is_file() {
        let tmp = tempdir();
        let file = tmp.join("not_a_dir.txt");
        fs::write(&file, "hello").unwrap();

        let result = run_script(
            file.to_string_lossy().to_string(),
            "echo hello".to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a directory"));
    }

    // ─── helpers ────────────────────────────────────────────────────

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gnarterm_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
