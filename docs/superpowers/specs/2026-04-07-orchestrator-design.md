# GnarTerm Orchestrator: Design Spec

## Overview

Evolve GnarTerm from a terminal workspace manager into a **developer cockpit** -- a terminal-first, project-centric tool that combines terminal workspaces, git worktree management, and AI agent orchestration. Preserve the existing terminal emulation quality while adding project awareness, worktree isolation, and harness-first workflows.

## Identity

**Terminal-first developer cockpit.** GnarTerm is your daily-driver terminal that also orchestrates AI coding agents. The terminal experience is the foundation; agent orchestration is the differentiating capability built on top.

Not an IDE. Not an agent-only tool. A cockpit for developers who use AI agents as part of their workflow.

---

## Data Model

### Workspace Types

Three workspace types, each with different capabilities:

| Feature                            | Personal | Project | Worktree |
| ---------------------------------- | -------- | ------- | -------- |
| Terminal tabs                      | yes      | yes     | yes      |
| Harness tabs                       | yes      | yes     | yes      |
| Split panes                        | yes      | yes     | yes      |
| Right sidebar (diff/files/commits) | no       | no      | yes      |
| CWD locked to directory            | no       | no      | yes      |
| Agent status detection             | yes      | yes     | yes      |

- **Personal Workspace**: Singular, always exists. Harnesses and terminals with splits. No project context, no git features, no right sidebar.
- **Project Workspace**: Non-worktree workspace rooted at a project's main directory. Terminals can `cd` freely. One per project.
- **Worktree Workspace**: Isolated git worktree with its own branch. Terminals locked to the worktree directory. N per project.

### Project

A registered git repository (or local directory).

```typescript
interface Project {
  id: string;
  name: string;
  path: string; // local git repo root
  remote?: string; // origin URL
  active: boolean; // shown in main list vs inactive drawer
}
```

- Registered manually: point to a local directory or clone from GitHub.
- Non-git directories cannot have worktree workspaces.
- Projects can be set active/inactive. Inactive projects collapse into a drawer at the bottom of the sidebar.
- Projects can be removed from GnarTerm (does not delete the directory).

### Workspace Metadata

```typescript
type WorkspaceType = "personal" | "project" | "worktree";
type WorkspaceStatus = "active" | "stashed" | "archived";

interface WorkspaceMeta {
  id: string;
  type: WorkspaceType;
  name: string;
  status: WorkspaceStatus;
  // worktree-specific
  branch?: string;
  baseBranch?: string;
  worktreePath?: string;
}
```

### Harness Preset

```typescript
interface HarnessPreset {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  icon?: string;
}
```

Default harness: Claude Code.

### Surface Types

Extending the existing `TerminalSurface | PreviewSurface` union:

```typescript
type Surface =
  | TerminalSurface // existing -- shell PTY
  | PreviewSurface // existing -- file preview
  | HarnessSurface // new -- agent CLI PTY with status detection
  | DiffSurface // new -- git diff viewer (worktree only)
  | FileBrowserSurface // new -- file tree (worktree only)
  | CommitHistorySurface; // new -- commit log (worktree only)

interface HarnessSurface {
  kind: "harness";
  id: string;
  presetId: string; // references HarnessPreset.id
  terminal: Terminal; // xterm.js instance (agent CLI is still a PTY)
  ptyId: number;
  status: AgentStatus; // detected via OSC 9 / title / process state
  title: string;
}

type AgentStatus = "idle" | "running" | "waiting" | "error" | "exited";
```

---

## Settings System

### settings.json (user preferences)

VSCode-style JSON configuration at `~/.config/gnar-term/settings.json`. Sensible defaults for everything -- the file can start empty.

```json
{
  "theme": "tokyo-night",
  "fontSize": 14,
  "fontFamily": "MesloLGS Nerd Font",
  "opacity": 1.0,

  "worktreePrefix": "jrvs/",
  "worktreeBaseDir": "siblings",

  "harnesses": [
    {
      "id": "claude",
      "name": "Claude Code",
      "command": "claude",
      "args": [],
      "env": {},
      "icon": "claude"
    },
    {
      "id": "codex",
      "name": "Codex",
      "command": "codex",
      "args": [],
      "env": {},
      "icon": "codex"
    }
  ],
  "defaultHarness": "claude",

  "keybindings": {
    "home": "cmd+shift+h",
    "newWorktree": "cmd+shift+n",
    "toggleRightSidebar": "cmd+shift+e",
    "stashWorkspace": "cmd+shift+s"
  },

  "commands": [
    {
      "name": "Dev Server",
      "command": "npm run dev",
      "keybinding": "cmd+shift+d"
    },
    {
      "name": "Run Tests",
      "command": "npm test",
      "confirm": true
    }
  ],

  "statusDetection": {
    "oscNotifications": true,
    "titleParsing": true,
    "processMonitoring": true,
    "idleThresholdMs": 5000
  }
}
```

#### worktreeBaseDir

Controls where worktrees are created on disk:

- `"siblings"` (default) -- sibling directories to the repo: `<repo>-worktrees/<branch>/`
- `"nested"` -- inside the repo's `.worktrees/` directory
- Custom absolute path -- e.g., `"/Users/jarvis/.gnar-worktrees"`

### state.json (runtime state)

Managed by GnarTerm, not user-edited. Located at `~/.config/gnar-term/state.json`.

```json
{
  "personalWorkspace": {
    "splitRoot": { "type": "pane", "pane": { "surfaces": [] } }
  },
  "projects": [
    {
      "id": "proj_abc",
      "name": "gnar-term",
      "path": "/Users/jarvis/code/gnar-term",
      "remote": "git@github.com:TheGnarCo/gnar-term.git",
      "active": true,
      "workspaces": [
        {
          "id": "ws_001",
          "type": "project",
          "name": "main",
          "status": "active"
        },
        {
          "id": "ws_002",
          "type": "worktree",
          "name": "Add auth flow",
          "branch": "jrvs/add-auth-flow",
          "baseBranch": "main",
          "worktreePath": "/Users/jarvis/code/gnar-term-worktrees/jrvs/add-auth-flow",
          "status": "active"
        },
        {
          "id": "ws_003",
          "type": "worktree",
          "name": "Fix nav bug",
          "branch": "jrvs/fix-nav-bug",
          "baseBranch": "main",
          "worktreePath": "/Users/jarvis/code/gnar-term-worktrees/jrvs/fix-nav-bug",
          "status": "stashed"
        }
      ]
    }
  ]
}
```

### Per-project overrides

A `gnar-term.json` at a project's root provides project-level setting overrides only:

```json
{
  "worktreePrefix": "team/",
  "defaultHarness": "codex",
  "harnesses": [
    {
      "id": "claude-review",
      "name": "Claude (Review Mode)",
      "command": "claude",
      "args": ["--permission-mode", "plan"],
      "env": {}
    }
  ]
}
```

Project-level harnesses **merge** with global harnesses (project adds/overrides by `id`, doesn't replace the whole list).

### File hierarchy

```
~/.config/gnar-term/
  settings.json          -- user preferences (hand-editable)
  state.json             -- runtime state (app-managed)
  shell/                 -- shell integration scripts (existing)
    .zshrc
    bash-integration.sh
    fish-integration.fish
```

### Breaking changes from current config

- No more cmux compatibility (clean break).
- The old `gnar-term.json` format (with `commands` defining workspace layouts, `autoload`) is replaced entirely.
- Workspace layouts are no longer declarative from config. Workspaces are created through the UI and persisted in `state.json`.
- Custom commands move to `settings.json` under `"commands"`.

---

## Home Screen

GnarTerm launches to a home screen instead of directly into a workspace.

### Layout

```
+----------------------------------------------------------+
| [Home] GnarTerm                               [Settings] |
+----------+-----------------------------------------------+
|          |                                                |
| Personal |   PROJECTS                                     |
|          |                                                |
| PROJECTS |   +--------------+  +--------------+          |
| * gnar   |   | gnar-term    |  | client-app   |          |
| * client |   | ~/code/gnar  |  | ~/code/app   |          |
|          |   |              |  |              |          |
|----------|   | * main       |  | * main       |          |
| >Inactive|   | * jrvs/feat  |  |              |          |
|          |   | o jrvs/fix   |  | [+ Worktree] |          |
|          |   |              |  |              |          |
|          |   | [+ Worktree] |  +--------------+          |
|          |   +--------------+                             |
|          |                                                |
|          |   [+ Add Project]  [Clone from GitHub]         |
|          |                                                |
+----------+-----------------------------------------------+
```

### Interactions

- **Clicking "Personal"** opens the personal workspace.
- **Clicking a project card** expands/navigates to show its workspaces.
- **Clicking a workspace** (e.g., "main", "jrvs/feat") opens it.
- **"+ Worktree"** triggers the worktree creation flow.
- **"+ Add Project"** opens a directory picker.
- **"Clone from GitHub"** prompts for a repo URL, clones it, registers it.
- **Right-click a project** to set inactive or remove.
- Active workspaces shown with filled indicator (\*), stashed with open (o).
- Inactive drawer at sidebar bottom, collapsed by default.

### Worktree creation flow

```
+------------------------------+
| New Worktree Workspace       |
|                              |
| Project: gnar-term           |
|                              |
| Base branch:                 |
| [main                     v] |
|                              |
| Branch name:                 |
| [jrvs/_____________________ ]|
|                              |
| Workspace name (optional):   |
| [____________________________]|
|                              |
|        [Cancel]  [Create]    |
+------------------------------+
```

- Base branch dropdown shows local and remote branches.
- Branch name pre-fills the configured prefix from settings.
- Workspace name defaults to the branch name if left empty.
- On "Create": `git worktree add` runs, workspace appears in sidebar, opens automatically.

---

## Workspace Chrome

### Title bar with breadcrumb navigation

```
+------------------------------------------------------+
| [Home] GnarTerm > gnar-term > jrvs/feat-x     [Gear] |
+------------------------------------------------------+
```

- Clicking "Home" or the home icon returns to home screen.
- Clicking the project name navigates to project view.
- Current workspace name shows where you are.

### Tab bar

```
[+ Harness v] [Claude Code] [Codex]  |  [Terminal 1] [Terminal 2] [+ Terminal]
```

- Harness tabs on the left (primary), terminal tabs on the right, separated by a divider.
- "+" harness button shows a dropdown of configured harness presets.
- Each tab's content area supports the existing split pane model.
- Harness tabs can be split to add terminals alongside the agent CLI.
- Multiple harness tabs allowed (different agents, or same agent multiple times).

### Right sidebar (worktree workspaces only)

A collapsible panel on the right, toggled via keybinding or button. Contains a vertical stack of git-aware surfaces:

```
+--------------+
| FILES         |  -- file tree rooted at worktree
|  src/         |
|  package.json |
|--------------|
| CHANGES       |  -- staged/unstaged diff summary
|  M src/app.ts |
|  A src/new.ts |
|--------------|
| COMMITS       |  -- commits ahead of base branch
|  abc123 feat  |
|  def456 fix   |
+--------------+
```

- Each section is collapsible.
- Clicking a file in FILES or CHANGES opens it in the existing preview system.
- Clicking a commit expands its diff inline.

### Left sidebar (always present)

```
+-----------------+
| Personal         |
|-----------------|
| PROJECTS         |
| * gnar-term      |
|   |- main (2)    |
|   |- jrvs/feat-x |
|   '- jrvs/fix-y  |
| * client-app     |
|   '- jrvs/redesign
|-----------------|
| > Inactive (2)   |
+-----------------+
```

- Personal workspace always at top.
- Active projects with their workspaces (active and stashed).
- Stashed workspaces shown dimmed.
- Inactive projects in a collapsed drawer at the bottom.

---

## Worktree Lifecycle

### Three-stage lifecycle

```
              +--------+
  create ---> | Active |  --- terminals running, in sidebar
              +---+----+
                  | stash
                  v
              +---------+
              | Stashed |  --- terminals killed, worktree on disk,
              +---+-----+      hidden in stash section
                  | archive
                  v
              +----------+
              | Archived |  --- worktree removed from disk,
              +----------+      branch optionally kept/deleted
```

### Transitions

| Action                        | What happens                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stash**                     | All PTY sessions killed. Workspace moves to stashed section. Worktree stays on disk. Branch untouched.                                                                                             |
| **Restore** (stash to active) | Workspace reappears in active section. New terminal/harness sessions spawned in the existing worktree directory.                                                                                   |
| **Archive**                   | Prompt: "Push branch before archiving?" If yes, pushes. Then `git worktree remove`. Optionally deletes the branch. Workspace moves to archived in `state.json` (metadata kept, no disk footprint). |
| **Delete**                    | Removes archived workspace entry from `state.json` entirely.                                                                                                                                       |

### CWD enforcement for worktree workspaces

When spawning a PTY in a worktree workspace:

1. Set `cwd` to the worktree path.
2. Set `GNARTERM_WORKTREE_ROOT` environment variable.
3. Shell integration hook enforces the boundary:

```sh
# zsh (in gnarterm's custom ZDOTDIR)
if [ -n "$GNARTERM_WORKTREE_ROOT" ]; then
  _gnarterm_enforce_worktree() {
    case "$PWD" in
      "$GNARTERM_WORKTREE_ROOT"*) ;;
      *) cd "$GNARTERM_WORKTREE_ROOT" && echo "gnarterm: stayed in worktree" ;;
    esac
  }
  chpwd_functions+=(_gnarterm_enforce_worktree)
fi
```

4. OSC 7 CWD tracking (already in place) detects violations as a visual backup.

---

## Rust Backend: New Git Commands

```rust
// Worktree management
fn create_worktree(repo_path: String, branch: String, base: String) -> String
fn remove_worktree(worktree_path: String) -> ()
fn list_worktrees(repo_path: String) -> Vec<WorktreeInfo>

// Branch operations
fn list_branches(repo_path: String, include_remote: bool) -> Vec<BranchInfo>
fn push_branch(repo_path: String, branch: String) -> ()
fn delete_branch(repo_path: String, branch: String, remote: bool) -> ()

// Diff / status for right sidebar
fn git_status(worktree_path: String) -> Vec<FileStatus>
fn git_diff(worktree_path: String, path: Option<String>) -> String
fn git_log(worktree_path: String, base_branch: Option<String>) -> Vec<CommitInfo>
```

---

## Agent Status Detection

Three-layer passive detection system. No agent cooperation required beyond what they already emit.

### Layer 1: OSC 9 Interception

Extend the existing OSC parser in the Rust PTY reader thread. For harness surfaces:

- OSC 9 received: set status to `waiting` (agent completed turn, wants input).
- Intercept notification payload for display in sidebar badge.
- Optionally suppress system notification (GnarTerm handles it natively).

Works out of the box for: Claude Code, Codex CLI, OpenCode.

### Layer 2: OSC 0 Title Parsing

Already parsed in the backend. For harness surfaces, pattern-match known state strings:

| Title contains | Status    |
| -------------- | --------- |
| `Thinking...`  | `running` |
| `Working...`   | `running` |
| `Waiting...`   | `waiting` |
| `Starting...`  | `running` |
| `Ready`        | `idle`    |

Works for: Codex CLI (encodes state in title). Other agents get their task description displayed but not parsed for status.

### Layer 3: Process State Monitoring

Universal fallback. Monitor the PTY child process:

- Process actively writing to PTY: `running`
- Process idle, no output for N seconds: `idle` (likely waiting for input)
- Process exited, code 0: `exited` (success)
- Process exited, code != 0: `error`

Configurable idle threshold via `statusDetection.idleThresholdMs` in settings.

### Status priority

Most specific signal wins: OSC 9 > OSC 0 title > Process state.

### Status display

Status appears in three places:

1. **Harness tab label**: colored dot next to the tab name.
2. **Sidebar workspace entry**: badge on the workspace row.
3. **Home screen project card**: aggregate status (e.g., "2 running, 1 waiting").

---

## Project Registration

### Add local directory

1. User clicks "+ Add Project" on home screen.
2. Native directory picker opens.
3. GnarTerm checks if the directory is a git repo.
4. Project registered in `state.json` with `active: true`.
5. If git-backed, `remote` populated from `origin` URL.
6. If not git-backed, worktree features disabled for this project.

### Clone from GitHub

1. User clicks "Clone from GitHub".
2. Prompt for repo URL (HTTPS or SSH).
3. GnarTerm clones to a configured or prompted directory.
4. Project registered in `state.json`.

### Project management

- **Set inactive**: project moves to inactive drawer, all workspaces stashed.
- **Remove**: project removed from `state.json`. Does not delete the directory. Active worktrees prompt for cleanup.

---

## Default Workspace Contents

When a workspace is opened for the first time (or restored from stash), it starts with:

- **Personal Workspace**: one harness tab (default harness) with a single pane.
- **Project Workspace**: one harness tab (default harness, or project-level default) with a single pane. CWD set to project root.
- **Worktree Workspace**: one harness tab (default harness, or project-level default) with a single pane. CWD set to worktree path.

Users add additional tabs and splits from there. Layout is persisted in `state.json` for active workspaces and restored on reopen. Stashing kills sessions but preserves the layout definition so it can be recreated on restore.
