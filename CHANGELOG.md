# Changelog

All notable changes to GnarTerm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Project system**: Register local directories or clone from GitHub. Projects track git-backed status, color, and active/inactive state.
- **Managed workspaces**: Git worktree-backed workspaces with CWD enforcement, branch isolation, and right sidebar (diff, files, commits).
- **Terminal workspaces**: Ad-hoc shell workspaces (renamed from "scratchpad"). Can be project-scoped or floating (project-free).
- **Floating workspaces**: Top-level terminal workspaces that don't belong to any project. Auto-incrementing names (Terminal 1, Terminal 2, ...).
- **Home screen / Dashboard**: Project cards grid with workspace listing, inactive project drawer.
- **Settings system**: `~/.config/gnar-term/settings.json` with defaults, project-level overrides, and migration from legacy config formats.
- **State persistence**: `~/.config/gnar-term/state.json` for projects, workspaces, and floating workspaces. Source of truth for all structural data.
- **Harness status detection**: Three-layer inference (OSC notifications > title parsing > idle timeout) for AI agent status.
- **PTY exit code propagation**: Child process exit codes now reach the frontend for accurate harness error/exited status.
- **Confirm dialog**: In-app themed confirmation dialog for destructive actions (workspace close).
- **Loading states**: Loading bar for clone and worktree creation operations.
- **Right sidebar**: Git status, file browser, and commit history for managed workspaces.
- **New workspace dialog**: Tabbed dialog for creating terminal or managed workspaces with branch selection.
- **New project dialog**: Accepts `owner/repo` shorthand, full URLs, or SSH paths. Normalizes to cloneable URL.
- **Preview system**: File preview surfaces for markdown, JSON, CSV, YAML, images, video, PDF.
- **Diff view**: Inline git diff viewer as a surface type.
- **Git operations**: Rust commands for clone, worktree CRUD, branch listing, status, diff, log, ls-files.
- **Font detection**: Auto-detect terminal font from Ghostty, Alacritty, Kitty, WezTerm, iTerm2, and installed Nerd Fonts.
- **Shell integration**: Automatic OSC 7 CWD reporting for zsh (via ZDOTDIR override) and bash.
- **PTY flow control**: Backpressure via pause/resume with condvar-based blocking (no CPU spin).

### Changed

- **Rust backend split**: Monolithic `lib.rs` (1380 LOC) decomposed into 6 modules: `pty`, `git`, `fs`, `font`, `osc`, `b64`.
- **App.svelte decomposed**: Extracted `pane-service.ts`, `terminal-focus.ts`, `workspace-actions.ts`, `keybindings.ts` from the God component.
- **Config bridge removed**: `config.ts` legacy bridge deleted. `settings.ts` is the sole config source.
- **Workspace terminology**: "scratchpad" renamed to "terminal", "worktree" renamed to "managed" (with auto-migration of persisted data).
- **Workspace.meta renamed to Workspace.record** for clarity with WorkspaceRecord type.
- **Title bar**: Centered title showing context-aware breadcrumbs (project > workspace name with type label).
- **Sidebar**: New dropdown for creating terminals or projects. Hover-to-close on workspace entries. Auto-collapse empty projects. +/- collapse indicators.
- **Theme references**: Components use canonical theme fields (`ansi.green` not `termGreen`, `fgDim` not `dim`).
- **Base64**: Hand-rolled implementation replaced with `base64` crate.
- **Archive dialog**: Text input yes/no replaced with proper confirm dialog.

### Fixed

- Duplicate `safeFocus` implementations consolidated (tick vs requestAnimationFrame race).
- Duplicate `PreviewSurface` type definition eliminated.
- Inconsistent `getSettings` import paths standardized.
- Silent error handling for clone/worktree failures now shows error dialogs.
- Workspace close now persists to state.json (prevents ghost restore on restart).
- Last workspace close shows dashboard instead of creating a blank terminal.
- Dead `personalWorkspace` removed from state.
- Unused `isActivePane` prop removed from PaneView.
- Accessibility: Clickable divs replaced with buttons in HomeScreen, ProjectCard, RightSidebar, Sidebar.

### Removed

- `src/lib/config.ts` — legacy bridge between old config format and settings system.
- `PersonalWorkspaceState` — unused type and default state field.
