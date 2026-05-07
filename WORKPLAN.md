# GnarTerm Workplan

> **Status note (2026-05-07).** The `dev` branch underwent two structural
> refactors after the original 2026-04-04 audit was written:
>
> 1. **Frontend** moved from vanilla TS modules (`terminal-manager.ts`,
>    `sidebar.ts`, `markdown-viewer.ts`, `preview/*.ts`) to Svelte
>    components and `src/lib/` services. Several findings reference
>    files that no longer exist; the feature behind each finding has been
>    reassessed against the new layout.
> 2. **Rust backend** split from a single 2,285-line `lib.rs` into
>    `pty.rs`, `fs_commands.rs`, `file_watch.rs`, `git_*.rs`,
>    `mcp_*.rs`, and `commands.rs`. Line numbers from the original
>    audit are stale; updated locations are noted inline.
>
> This file restores the audit and reconciles each item against `dev`.
> Where the specific code path is gone but the original intent has been
> satisfied at a different layer, that is called out explicitly.

## Completed

### 1. Font Detection ✅

- [x] Rust `detect_font` command with platform fallback chain (now in `src-tauri/src/fs_commands.rs`)
- [x] Fallback chain: Ghostty → Alacritty → Kitty → WezTerm → iTerm2 → Terminal.app → `~/Library/Fonts` scan → `fc-list` (Linux)
- [x] Frontend integration with bundled JetBrainsMono Nerd Font as safety net (`src/lib/terminal-service.ts`)

### 2. Color Theme ✅

- [x] No `#000000` anywhere — all colors use theme variables
- [x] xterm.js terminal background matches theme
- [x] Sidebar and tab bar backgrounds are theme-aware
- [x] 10 themes defined (6 dark, 4 light) — see `src/lib/theme-data.ts`

### 3. Pane Management Controls ✅

- [x] Split + close controls per pane (`src/lib/components/PaneView.svelte`, `TabBar.svelte`)
- [x] New surface (+) button in tab bar
- [x] New workspace (+) button in sidebar (`src/lib/components/PrimarySidebar.svelte`)
- [x] Right-click context menu on panes and workspaces (`src/lib/components/ContextMenu.svelte`)

### 4. Keyboard Shortcuts (cmux-exact) ✅

- [x] All cmux-parity shortcuts wired in `src/main.ts` / `App.svelte` keyboard handlers
- [x] Cmd+N, Cmd+T, Cmd+D, Cmd+Shift+D, Cmd+W, Cmd+Shift+W
- [x] Cmd+1-9, Ctrl+1-9, Cmd+Shift+]/[, Ctrl+Cmd+]/[
- [x] Opt+Cmd+Arrows, Cmd+Shift+Enter, Cmd+B, Cmd+Shift+H, Cmd+Shift+R, Cmd+P
- [x] Cross-platform: Cmd on macOS, Ctrl on Linux (per `terminal-service.ts` `isMac`)

### 5. Terminal Functionality ✅

- [x] `exit` closes the surface/pane correctly
- [x] Copy/paste works including Linux Ctrl+Shift+C/V
- [x] Scrollback configured per terminal in `TerminalSurface.svelte`

---

## Audit Findings (originally 2026-04-04, reconciled 2026-05-07)

Status legend: ✅ resolved · 🔄 moved/partial · ❌ open · ⊘ obsolete (code path removed without replacement; intent met by structural change)

### P0 — Security: XSS + Unrestricted File Access

The original exploit chain was: a malicious markdown file executes JS in
the webview, then invokes `read_file`/`write_file` on arbitrary paths.
Both halves of the chain have been broken on `dev`.

- [x] **S1.** ✅ XSS in markdown preview — `src/lib/preview/previewers/markdown.ts:2,96` imports DOMPurify and calls `DOMPurify.sanitize` on the parsed HTML before assigning to `innerHTML`.
- [x] **S2.** ✅ XSS in image preview — `src/lib/preview/previewers/image.ts` builds the `<img>` via `document.createElement` and assigns `img.src`/`img.alt` as DOM properties; no `innerHTML` interpolation. Original `preview/image.ts:10` is gone.
- [x] **S3.** ✅ XSS in video preview — `src/lib/preview/previewers/video.ts` uses `createElement('video')` with property assignments. Same pattern as S2.
- [x] **S4.** ✅ `read_file` now calls `validate_read_path` (`src-tauri/src/fs_commands.rs:97`); validator at `fs_commands.rs:50` canonicalizes the path and rejects anything matching `is_blocked_path` (SSH keys, GnuPG, AWS creds, .netrc, .git-credentials, .npmrc, .pypirc — see test suite at `fs_commands.rs:875+`).
- [x] **S5.** ✅ `write_file` calls `validate_write_path` (`fs_commands.rs:307`); validator normalizes `..`/`.` components and enforces a `.gnar-term/` allowlist (line 218+).
- [x] **S6.** ✅ `ensure_dir` calls `validate_write_path` (`fs_commands.rs:500`).
- [ ] **S7.** ❌ Tauri v2 capabilities still broad (`src-tauri/capabilities/default.json` permits `core:default` plus the standard plugin permissions). **Intent partially met:** every custom IPC command now self-validates in Rust, so capability-level scoping is defence-in-depth rather than the sole gate. Worth tightening capabilities to deny custom commands by default and explicitly allow per-window, but not load-bearing now that S4–S6 are fixed.

### P1 — Security: Command Injection

- [x] **S8.** ⊘ `open_with_default_app` Windows branch removed entirely (`fs_commands.rs:563`); only `open` (macOS) and `xdg-open` (Linux) remain, both invoked with separate `.arg()` calls — no shell. Path is `validate_read_path`-checked first. GnarTerm is now macOS+Linux only per `CLAUDE.md`.
- [x] **S9.** ⊘ `show_in_file_manager` Windows branch removed (`fs_commands.rs:537`). Same pattern: `open -R` / `xdg-open` with `.arg()`, path validated. The `find_file` command additionally rejects names starting with `-` to prevent flag injection in `mdfind`/`locate`/`find`.

### P1 — Bugs: Correctness

- [x] **B1.** ✅ `pid as i32` cast replaced with `i32::try_from(pid)` (`src-tauri/src/pty.rs:494+`); on overflow returns `Err("PID {pid} exceeds i32::MAX")` instead of corrupting the kill target. Production `kill_pty` also signals the negative pgid first (`-pid_i32`) before the bare pid.
- [x] **B2.** ✅ OSC 7 CWD parsing — original `lib.rs:208-209` site no longer exists. Current logic (verified by tests `osc7_parse_empty_hostname`, `osc7_parse_with_hostname`, `osc7_parse_no_scheme` at `pty.rs:921+`) handles `file:///path`, `file://hostname/path`, and bare paths correctly without the leading-`/` loss.
- [x] **B3.** ⊘ Sidebar drag-drop reorder — `sidebar.ts` removed. Reorder now lives in `src/lib/actions/drag-reorder.ts` and `src/lib/components/WorkspaceListBlock.svelte` (commit at line ~193, 230) operating on `$rootRowOrder`. Different algorithm; original off-by-one ternary is impossible by construction.
- [x] **B4.** ⊘ "Close Other Workspaces" — `sidebar.ts:304-309` removed. Workspace deletion now goes through `deleteWorkspace` in `src/lib/services/workspace-service.ts:102` which the Svelte view (`WorkspaceSectionContent.svelte:218`) drives off the reactive store, so iteration-during-mutation is no longer possible.

### P2 — Bugs: Resource Leaks

- [x] **B5.** ✅ `state.ptys.lock().unwrap()` in production replaced with `.lock().map_err(|e| e.to_string())?` throughout `pty.rs` and `file_watch.rs`. Remaining `.unwrap()` calls are inside `#[cfg(test)]` modules (`pty.rs:719+`, `file_watch.rs:155+`) where a poisoned mutex is fine to panic on.
- [x] **B6.** ✅ `watch_file` (`src-tauri/src/file_watch.rs:71`) now creates an `Arc<AtomicBool>` stop flag stored in `AppState.watch_flags`, returns a `watch_id`, and the polling loop checks the flag each iteration. `unwatch_file` (`file_watch.rs:106`) and `cancel_watch` (line 96) flip the flag and remove the entry. `watch_claude_file`/`unwatch_claude_file` use the same machinery.
- [x] **B7.** ✅ ResizeObserver lifecycle — `src/lib/components/PaneView.svelte:195` creates the observer in `onMount`, `:203` disconnects in `onDestroy`. Service-layer disposal also covered: `pane-service.ts:115`, `surface-service.ts:130`, `workspace-runtime-service.ts:337` all call `pane.resizeObserver?.disconnect()` on tear-down.
- [x] **B8.** ⊘ The persistent-pane-element pattern from `terminal-manager.ts:647` is gone. Listeners are now component-scoped in Svelte; `ArchiveZone.svelte:110-111`, `tab-drag.ts:181-183` add and explicitly remove `mousemove`/`mouseup`/`keydown` window listeners. PreviewSurface cleans up its own click handler at `PreviewSurface.svelte:113`.
- [x] **B9.** ✅ Preview registry exposes a `dispose?: () => void` on previewers (`src/lib/services/preview-registry.ts:16`) and `PreviewSurface.svelte` calls `unregisterPreviewSurface` on teardown (`:118`). Surfaces returning an unlisten function from Tauri `listen()` store and invoke it via `dispose`.
- [x] **B10.** ✅ `Previewer.render` widened to optionally return a cleanup callback; `openPreview` threads it into the `PreviewResult.dispose` (composing with the existing watcher unlisten). The PDF previewer (`src/lib/preview/previewers/pdf.ts`) now captures the Blob URL + iframe and returns a dispose that calls `URL.revokeObjectURL` and removes the iframe, with a `disposed` flag so a teardown that races ahead of `read_file_base64` is safe. Regression tests in `src/__tests__/preview-coverage.test.ts`.

### P3 — Dead Code

- [x] **D1.** ⊘ `src/markdown-viewer.ts` removed; `src/lib/preview/previewers/markdown.ts` is the single source.
- [x] **D2.** ✅ `CONFIG_FILENAMES` now used at `src/lib/config.ts:288` (spread into `findInLocations`).
- [x] **D3.** ✅ `canPreview` is now wired as a runtime gate in `openFileAsPreviewSplit` (`src/lib/services/surface-service.ts:427`). Files whose extension has no registered previewer are handed off to `open_with_default_app` instead of opening an empty preview surface that would render an error. Regression tests in `src/__tests__/open-file-as-preview-split.test.ts` cover both branches.
- [x] **D4.** ✅ `getCommands` inlined into `getWorkspaceCommands`. The standalone helper had no external callers; folding the one-line `_config.commands || []` lookup into its only consumer kills the dead export without abstraction loss.
- [x] **D5.** ✅ `tokio` features narrowed from `["full"]` to `["rt", "rt-multi-thread", "macros", "net", "io-util", "io-std", "sync", "time"]` (`src-tauri/Cargo.toml:23`).
- [x] **D6.** ✅ Runtime `tauri-build` entry removed from `[dependencies]`; only the `[build-dependencies]` entry remains, which is the correct shape.

---

## Open work (minimum viable cleanup)

The remaining unchecked items from the 2026-04-04 audit:

- **S7** — capability scoping (defence-in-depth, low priority since S4–S6 fixed).

Everything else from the original audit is either fixed in place or
obsolete because the surrounding code was refactored away.
