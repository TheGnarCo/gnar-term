# GnarTerm

Terminal-first developer cockpit. Tauri v2 app with a Rust backend (portable-pty) and Svelte 5 frontend (xterm.js). Combines terminal workspaces, git worktree management, and AI agent orchestration.

## Build & Test

```bash
npm test                    # vitest unit tests (448 tests)
npm run build               # full tauri build (frontend + Rust)
cargo check                 # quick Rust compilation check (from src-tauri/)
cargo test                  # Rust unit tests (66 tests, from src-tauri/)
```

All tests must pass and `npm run build` must succeed before pushing any commit. Do not declare work complete without a green test suite.

## Slack

When posting in the `#pull-requests` Slack channel, prefix the message with the `:gnar-term:` emoji.

## Branching & PRs

- All work on feature branches, never commit directly to main
- Always `git checkout main` before creating a new branch — never branch off other feature branches
- Every bug fix and feature must include regression tests
- Use plan mode for audits, migrations, and multi-step tasks
- Disable sandbox for SSH git ops (`git push/pull/fetch`) and `gh` commands

### PR test plans

Every PR must have a `## Test plan` section with step-by-step manual verification checkboxes. After running each verification step, check it off (`[x]`) in the PR body. The user is a manager who relies on the test plan to track QA progress — unchecked items mean unverified work.

## Releases

Releases are tag-based with zero code changes. Use the `/create_new_release` command or manually:

```bash
git tag v0.4.0
git push origin v0.4.0
```

CI derives version from the tag. Do NOT edit version files for releases.

See `.github/workflows/release.yml` for the full pipeline (macOS, Linux, Windows builds + signing + Homebrew tap update).

## GitHub Actions

The Claude GitHub App is installed on this repo. `@claude` mentions in PRs trigger Claude Code via GitHub Actions to review, implement, or respond to requests.

## Commands

Custom slash commands live in `.claude/commands/`:

- `/create_new_release <version>` - tag and push a release

## Cross-Platform

gnar-term runs on macOS, Linux, and Windows. When making changes:

- **Never fix Linux and break macOS (or vice versa).** Use platform detection (`isMac` from `terminal-service.ts`) to branch behavior, not platform-specific code that replaces the other platform's logic.
- Keyboard shortcuts use Cmd on macOS, Ctrl on Linux/Windows. Both must work.
- Test clipboard, keyboard shortcuts, and PTY behavior on all platforms when possible.
- WebKitGTK (Linux webview) behaves differently from WKWebView (macOS) — watch for webview-level key interception differences.

## Testing Guidelines

- Write tests alongside the fix, not as a separate phase
- Tests must verify actual behavior, not just scan source code
- Trace features end-to-end through real code paths
- For PTY/terminal fixes, test with real terminal output, not just mocks
- Do NOT use AppleScript/screenshot GUI tests (they interrupt the user's screen)
- No `setTimeout` hacks to fix timing issues — diagnose root cause
