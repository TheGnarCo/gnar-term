# GnarTerm

Tauri v2 terminal workspace manager. Rust backend (portable-pty), Svelte frontend (xterm.js).

## Build & Test

```bash
npm test                    # vitest unit tests (293 tests)
npm run build               # full tauri build (frontend + Rust)
cargo check                 # quick Rust compilation check
```

All tests must pass and `npm run build` must succeed before pushing any commit. Do not declare work complete without a green test suite. You must NEVER merge PR's, especially to main.

## Slack

When posting in the `#pull-requests` Slack channel, prefix the message with the `:gnar-term:` emoji.

## Branching & PRs

- All work on feature branches, never commit directly to main
- Always `git checkout main` before creating a new branch — never branch off other feature branches
- Every bug fix and feature must include regression tests
- Use plan mode for audits, migrations, and multi-step tasks
- Disable sandbox for SSH git ops (`git push/pull/fetch`) and `gh` commands
- Commits on feature branches do not require explicit permission — when work on a feature branch is complete and tests pass, commit it. (Still never commit to main, never force-push, never merge PRs.)

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

## Architecture

See `docs/` for design documentation:

- **[docs/glossary.md](docs/glossary.md)** — canonical definitions for terms used across the codebase (workspace, pane, surface, etc.)
- **[docs/sidebar-architecture.md](docs/sidebar-architecture.md)** — primary/secondary sidebar layout, extension model, and control placement rules

### Frontend Structure

App.svelte is a thin shell that wires services to the DOM. Business logic lives in service modules:

- `src/lib/services/workspace-service.ts` — workspace CRUD, serialization, config persistence
- `src/lib/services/pane-service.ts` — pane split/close/focus, tab reorder, flash
- `src/lib/services/surface-service.ts` — surface select/close/navigate, preview
- `src/lib/services/service-helpers.ts` — shared utilities (safeFocus, getActiveCwd)

Shared behaviors are extracted as Svelte actions:

- `src/lib/actions/drag-resize.ts` — drag-to-resize for sidebars and split dividers

When adding new functionality, put business logic in the appropriate service module, not in App.svelte. App.svelte should only contain: component imports, store subscriptions, command palette definitions, keyboard shortcut handlers, and the template.

### Sidebar Rules

- Sidebar toggle buttons always live in the TitleBar, never in sidebar headers
- Primary sidebar: vertically scrolling sections; Workspaces section is always first
- Secondary sidebar: tab-controlled; each section is a tab; control row only renders when populated (via `controls` slot)
- Both sidebars are resizable (max 33% viewport width, min 140px)
