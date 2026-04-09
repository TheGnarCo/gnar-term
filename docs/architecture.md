# GnarTerm Architecture

## Overview

GnarTerm is a Tauri v2 desktop app with a Rust backend managing PTY sessions
and a Svelte 5 frontend rendering terminal surfaces via xterm.js.

## Rust Backend (`src-tauri/src/`)

The backend is split into focused modules:

| Module    | Responsibility                                                                   |
| --------- | -------------------------------------------------------------------------------- |
| `lib.rs`  | App wiring: `AppState`, Tauri builder, macOS menu, `generate_handler!`           |
| `pty.rs`  | PTY lifecycle: spawn, write, resize, kill, pause/resume (flow control)           |
| `git.rs`  | Git operations: clone, worktree CRUD, branch listing, status/diff/log            |
| `fs.rs`   | File I/O with security validation, file watching                                 |
| `font.rs` | Terminal font detection from installed configs (Ghostty, Alacritty, Kitty, etc.) |
| `osc.rs`  | OSC escape sequence classification (notifications, titles)                       |
| `b64.rs`  | Base64 encoding (via `base64` crate)                                             |

All Tauri commands are `pub async fn` in their modules. `lib.rs` registers
them via `tauri::generate_handler![]`.

### Shared State

```rust
pub struct AppState {
    pub ptys: Mutex<HashMap<u32, PtyInstance>>,
    pub watch_flags: Mutex<HashMap<u32, Arc<AtomicBool>>>,
}
```

Managed by Tauri — commands receive it via `state: tauri::State<'_, AppState>`.

### PTY Flow Control

The reader thread uses a `PauseFlag` (Mutex + Condvar) for backpressure.
When the frontend buffer exceeds 128KB, it calls `pause_pty`; the reader
thread blocks on the condvar instead of spinning. Frontend calls `resume_pty`
after draining below 32KB.

## Frontend (`src/`)

### Layer Map

```
App.svelte              Workspace switching, keyboard dispatch, initialization
  lib/
    types.ts            Domain model (see docs/domain-model.md)
    state.ts            Persisted state (state.json) — source of truth
    settings.ts         User settings (settings.json) + workspace layout types
    stores/
      workspace.ts      Svelte stores: workspaces, activeWorkspaceIdx, derived
      project.ts        Project CRUD backed by state.ts
      ui.ts             Visibility flags, navigation, loading, pendingAction
      dialog-service.ts Promise-backed imperative dialog drivers
      theme.ts          Theme store with xterm theme derivation
    terminal-service.ts PTY lifecycle, flow control, surface creation
    terminal-focus.ts   Shared safeFocusTerminal utility
    pane-service.ts     Pure pane/surface manipulation logic
    workspace-actions.ts Workspace lifecycle (create, restore, clone)
    keybindings.ts      Keyboard shortcut dispatch
    git.ts              Typed wrappers over Tauri git commands
    harness-status.ts   Three-layer agent status detection
    right-sidebar-data.ts Git data fetching for the right sidebar
  components/           Svelte components (Sidebar, TitleBar, PaneView, etc.)
  preview/              File preview system (markdown, JSON, image, etc.)
```

### State Architecture

**Source of truth:** `state.ts` manages `~/.config/gnar/state.json`.
All structural mutations (add/remove project, create/close workspace) go
through `state.ts` first, then the Svelte store is synced.

**Settings:** `settings.ts` manages `~/.config/gnar/settings.json`
(user-editable). Project-level overrides in `<project>/.gnar/settings.json`.

**Svelte stores** in `stores/` are reactive views over the persisted state.
They should never be the first place a mutation happens.

### Terminal Surface Lifecycle

1. `createTerminalSurface(pane, cwd)` creates xterm.js Terminal + addons
2. Terminal is opened into a DOM element by `TerminalSurface.svelte`
3. `connectPty(surface, cwd)` spawns the PTY via Tauri command
4. `pty-output` events flow through the flow control buffer to xterm.js
5. On exit, `pty-exit` event triggers cleanup or dashboard navigation
