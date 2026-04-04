# GnarTerm Workplan

## Completed

### 1. Font Detection ✅
- [x] Add logging to `detect_font` Rust command (`lib.rs:329-550`, multiple `println!` statements)
- [x] Fallback chain: Ghostty → Alacritty → Kitty → WezTerm → iTerm2 → Terminal.app → `~/Library/Fonts` scan → `fc-list` (Linux)
- [x] Frontend integration with bundled JetBrainsMono Nerd Font as safety net (`terminal-manager.ts:47-60`)

### 2. Color Theme ✅
- [x] No `#000000` anywhere — all colors use theme variables
- [x] `index.html` body background is `#161b22` (GitHub Dark)
- [x] xterm.js terminal background matches theme
- [x] Sidebar and tab bar backgrounds are theme-aware
- [x] 10 themes defined (6 dark, 4 light)

### 3. Pane Management Controls ✅
- [x] Split buttons in each pane's title area (`terminal-manager.ts:617-629`)
- [x] Close pane button (`terminal-manager.ts:629`)
- [x] New surface (+) button in tab bar (`terminal-manager.ts:580-587`)
- [x] New workspace (+) button in sidebar header (`sidebar.ts:50-54`)
- [x] Right-click context menu on pane: Split Right, Split Down, Close (`terminal-manager.ts:381-461`)
- [x] Right-click context menu on workspace: Rename, Close, Close Others (`sidebar.ts:263-325`)

### 4. Keyboard Shortcuts (cmux-exact) ✅
- [x] All 21+ shortcuts implemented (`main.ts:105-270`)
- [x] Cmd+N, Cmd+T, Cmd+D, Cmd+Shift+D, Cmd+W, Cmd+Shift+W
- [x] Cmd+1-9, Ctrl+1-9, Cmd+Shift+]/[, Ctrl+Cmd+]/[
- [x] Opt+Cmd+Arrows, Cmd+Shift+Enter, Cmd+B, Cmd+Shift+H, Cmd+Shift+R, Cmd+P

### 5. Terminal Functionality ✅
- [x] `exit` closes the surface/pane correctly (`terminal-manager.ts:173-182`)
- [x] Copy/paste works including Linux Ctrl+Shift+C/V (`terminal-manager.ts:313-321`)
- [x] Scrollback: 5000 lines (`terminal-manager.ts:249`)

---

## Code Audit Findings (2026-04-04)

### P0 — Security: XSS + Unrestricted File Access

These compose into an exploit chain: a malicious markdown file can execute JS in the webview, then invoke `read_file`/`write_file` on arbitrary paths.

- [ ] **S1.** XSS in markdown preview — unsanitized `marked.parse()` via `innerHTML` (`preview/markdown.ts:9`, `markdown-viewer.ts:91`). Add DOMPurify.
- [ ] **S2.** XSS in image preview — `filePath` interpolated into `innerHTML` unescaped (`preview/image.ts:10`)
- [ ] **S3.** XSS in video preview — same as S2 (`preview/video.ts:10`)
- [ ] **S4.** `read_file` accepts any path, zero validation (`lib.rs:574`). Scope to safe paths.
- [ ] **S5.** `write_file` accepts any path (`lib.rs:603`). Scope to safe paths.
- [ ] **S6.** `ensure_dir` creates any directory without validation (`lib.rs:609`)
- [ ] **S7.** Tauri v2 capabilities not leveraged to scope custom IPC commands (`capabilities/default.json`)

### P1 — Security: Command Injection

- [ ] **S8.** `open_with_default_app` passes path to `cmd /C start` on Windows — shell metacharacters inject commands (`lib.rs:640-648`)
- [ ] **S9.** `show_in_file_manager` same issue with `explorer /select,` on Windows (`lib.rs:621-636`)

### P1 — Bugs: Correctness

- [ ] **B1.** `pid as i32` cast in `kill_pty` — wraps negative if PID > i32::MAX, sends SIGKILL to wrong process group (`lib.rs:312`). Use `i32::try_from()`.
- [ ] **B2.** OSC 7 CWD path parsing off-by-one — leading `/` lost for `file://hostname/path` (`lib.rs:208-209`)
- [ ] **B3.** Drag-drop reorder: `fromIdx < idx ? idx : idx` is a no-op ternary, off-by-one when dragging forward (`sidebar.ts:114`)
- [ ] **B4.** "Close Other Workspaces" mutates array during index-based iteration, can close wrong workspaces (`sidebar.ts:304-309`)

### P2 — Bugs: Resource Leaks

- [ ] **B5.** `state.ptys.lock().unwrap()` at 4 call sites — mutex poison crashes app (`lib.rs:137,267,285,303`). Lines 555/565 correctly use `.map_err()`.
- [ ] **B6.** `watch_file` spawns a thread that loops forever with no cancellation (`lib.rs:654-672`). Each call leaks a thread.
- [ ] **B7.** New `ResizeObserver` on every `buildPaneElement`, never disconnected (`terminal-manager.ts:657`)
- [ ] **B8.** `mousedown` listener accumulates on persistent pane element with each rebuild (`terminal-manager.ts:647`)
- [ ] **B9.** `listen()` for `file-changed` returns unlisten function that is never stored or called (`preview/index.ts:85`)
- [ ] **B10.** `createObjectURL` Blob URL never revoked per PDF preview (`preview/pdf.ts:17`)

### P3 — Dead Code

- [ ] **D1.** `src/markdown-viewer.ts` — entire file is dead, superseded by `src/preview/markdown.ts`
- [ ] **D2.** `CONFIG_FILENAMES` array declared but never used (`config.ts:68-71`)
- [ ] **D3.** `TerminalManager.canPreview()` method never called (`terminal-manager.ts:1155-1157`)
- [ ] **D4.** `getCommands()` exported but never imported externally (`config.ts:122`)
- [ ] **D5.** `tokio` dependency with `features = ["full"]` never used — Tauri has its own runtime (`Cargo.toml:21`)
- [ ] **D6.** `tauri-build` listed as both runtime and build dependency — only needed as build dep (`Cargo.toml:17,24`)
