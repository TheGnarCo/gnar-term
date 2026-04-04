# Agent Teams — Feature Spec & Implementation Plan

## Overview

Add first-class support for Claude Code Agent Teams in gnar-term. Each teammate runs in its own visible terminal pane with live output, structured status metadata in the sidebar, and team lifecycle management — replacing the need for tmux or iTerm2 split panes.

This is gnar-term's primary differentiator over cmux: a native GUI with richer agent visibility than raw terminal splits can provide.

## Background

### How Claude Code Agent Teams Work

Agent Teams is an experimental Claude Code feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings). Key mechanics:

- **Team lead** — the primary Claude Code session that orchestrates work
- **Teammates** — separate Claude Code CLI processes spawned by the lead
- **Coordination** — file-based, no server:
  - Tasks: `~/.claude/tasks/{team-name}/*.json` (individual task files with status, assignment, dependencies)
  - Mailboxes: `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`
  - Config: `~/.claude/teams/{team-name}/config.json` (session IDs, member list)
  - Locking: `flock()` on `.lock` file prevents task-claiming races
- **Display modes** (via `--teammate-mode`):
  - `in-process` — all teammates inside one terminal, cycle with Shift+Down
  - `tmux` — each teammate in a tmux/iTerm2 split pane
  - `auto` (default) — tmux if available, else in-process

### How cmux Integrates (The Tmux Shim Pattern)

cmux's `claude-teams` command does NOT use `--teammate-mode tmux` directly. Instead it:

1. Sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
2. Prepends a **tmux shim** to `PATH` at `~/.cmuxterm/claude-teams-bin/`
3. The shim (~350 lines) intercepts tmux commands and translates them to cmux's socket API:
   - `tmux split-window` → `surface.split` (native cmux splits)
   - `tmux send-keys` → `surface.send_text`
   - `tmux capture-pane` → `surface.read_output`
   - `tmux select-pane` → `surface.focus`
   - `tmux kill-pane` → `surface.close`
   - `tmux list-panes` → `workspace.list`
4. Claude Code thinks it's talking to tmux, but cmux handles everything natively

**This is the pattern gnar-term should follow.** Rather than implementing a custom `--teammate-mode gnar-term`, we write a tmux shim that translates tmux commands into Tauri IPC calls (via a local socket or CLI bridge). Claude Code's existing `--teammate-mode tmux` works unchanged.

### cmux Sidebar Features for Teams

- Status pills (custom text per pane via `set-status`)
- Progress bars (`set-progress`)
- Notification rings (blue = needs attention)
- Auto-equalized pane layouts as teammates spawn/exit

### Where gnar-term Goes Further

| Capability | cmux | gnar-term (planned) |
|---|---|---|
| Agent panes | Terminal splits | Terminal splits + structured status overlay |
| Status info | Sidebar text | Sidebar badges + agent panel with metrics |
| Notifications | Blue ring | Typed notifications (info/warn/error) with color |
| Team lifecycle | CLI command | Command palette + config + context menu |
| Agent output | Raw terminal | Terminal + rich preview (diffs, logs) |
| Cross-agent awareness | None | File conflict detection, shared task view |
| Telemetry | None | Token usage, cost, duration per agent |

---

## Feature Scope

### Phase 1: Core Agent Panes (MVP)

**Goal:** Launch Claude Code agent teams inside gnar-term workspaces. Each teammate gets a visible terminal pane.

#### 1.1 Team-Aware Workspace Creation

Extend config to define agent team workspaces:

```json
{
  "commands": [
    {
      "name": "Research Team",
      "team": {
        "name": "research",
        "agents": [
          { "name": "lead", "role": "lead" },
          { "name": "web-search", "role": "teammate" },
          { "name": "summarizer", "role": "teammate" }
        ]
      },
      "workspace": {
        "name": "Research Team",
        "layout": {
          "direction": "horizontal",
          "children": [
            { "surfaces": [{ "name": "lead", "command": "claude" }] },
            {
              "direction": "vertical",
              "children": [
                { "surfaces": [{ "name": "web-search" }] },
                { "surfaces": [{ "name": "summarizer" }] }
              ]
            }
          ]
        }
      }
    }
  ]
}
```

#### 1.2 Tmux Shim (Critical Path)

gnar-term implements a **tmux shim** — a script placed on `PATH` that intercepts tmux commands from Claude Code and translates them into gnar-term operations. This is the same pattern cmux uses.

**How it works:**

1. gnar-term writes a shim script to `~/.config/gnar-term/bin/tmux`
2. When launching a team workspace, gnar-term prepends this directory to `PATH`
3. gnar-term starts a local Unix socket server (Rust backend) for IPC
4. Claude Code runs with `--teammate-mode tmux` and issues tmux commands
5. The shim intercepts those commands and sends them to gnar-term's socket

**Shim command mapping:**

| tmux command | gnar-term action |
|---|---|
| `tmux split-window [-h\|-v]` | Split active pane horizontally/vertically, spawn PTY in new pane |
| `tmux send-keys "text"` | Write to PTY via `write_pty` |
| `tmux capture-pane` | Read terminal buffer content |
| `tmux select-pane -t N` | Focus pane N |
| `tmux kill-pane` | Close surface, kill PTY |
| `tmux list-panes` | Return pane list with dimensions |
| `tmux new-window` | Create new workspace |
| `tmux select-window` | Switch workspace |

**Socket protocol:** JSON-RPC over Unix domain socket at `$GNARTERM_SOCKET_PATH`.

#### 1.3 Team Spawning

With the shim in place, team spawning is straightforward:

1. Create a workspace with a single lead pane
2. Set environment: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `PATH` with shim prepended
3. Spawn `claude --teammate-mode tmux` in the lead pane
4. Claude Code's own team mechanism handles the rest — it calls "tmux" (our shim) to create splits
5. gnar-term receives split/spawn commands via the socket and creates panes automatically
6. Tag surfaces with agent metadata as they're created by the shim

#### 1.3 Sidebar Metadata

Extend sidebar to show per-workspace agent info:

- Agent count badge (e.g., "3 agents")
- Team status: idle / working / waiting
- Per-surface agent role label (lead vs teammate name)

#### 1.4 Notifications

Leverage existing OSC notification pipeline:

- Claude Code already emits notifications via terminal escape sequences
- Map notification types to visual indicators:
  - Blue: agent working normally
  - Yellow: agent waiting for input/approval
  - Red: agent error or permission denied
  - Green: agent task completed

#### 1.5 Command Palette

Add team commands:

- "Launch Team: {name}" — from config
- "Pause All Agents" — send Ctrl+C / SIGSTOP to all teammate PTYs
- "Resume All Agents" — SIGCONT
- "Kill Team" — kill all teammate PTYs in workspace

#### 1.6 Context Menu

Right-click on agent surface:
- Interrupt Agent (sends Escape)
- Restart Agent
- Kill Agent

Right-click on team workspace (sidebar):
- Pause Team
- Resume Team
- Kill Team

---

### Phase 2: Agent Status Panel

**Goal:** Structured visibility beyond raw terminal output.

#### 2.1 Team Status Surface

New surface type: `agent-panel`. Shows a grid of all agents in the team:

```
┌──────────────┬────────────┬──────────────┬─────────┐
│ Agent        │ Status     │ Current Task │ Tokens  │
├──────────────┼────────────┼──────────────┼─────────┤
│ lead         │ 🟢 working │ Planning...  │ 12.4k   │
│ web-search   │ 🟡 waiting │ Approval     │  8.1k   │
│ summarizer   │ 🔵 idle    │ —            │  3.2k   │
└──────────────┴────────────┴──────────────┴─────────┘
```

Data sources:
- **Task list**: Poll `~/.claude/tasks/{team-name}/` for task status
- **Telemetry**: Read from `~/.claude/claudetop.d/` scripts (token counts, cost)
- **Session state**: Watch JSONL session files for latest activity

#### 2.2 Shared Task View

Surface that renders the team's shared task list from `~/.claude/tasks/{team-name}/`:

- Task name, status (pending/in-progress/completed), assignee
- Live updates via file watching (reuse existing `watch_file` infrastructure)
- Click task to jump to assignee's pane

#### 2.3 Agent Log Previewer

New preview plugin for agent session logs:

- Register for `.jsonl` files in `~/.claude/projects/`
- Render tool calls, responses, and errors with syntax highlighting
- Filter by: tool type, timestamp, agent name

---

### Phase 3: Cross-Agent Awareness

**Goal:** Detect and surface coordination issues.

#### 3.1 File Conflict Detection

Monitor CWD and file operations across agent panes:

- Track files each agent reads/writes (from PTY output + OSC 7 cwd)
- If two agents touch the same file, surface a warning in the sidebar
- Optional: show a diff panel

#### 3.2 Agent History

Persist team session metadata:

- Which agents ran, when, what tasks they completed
- Token usage and cost per session
- Stored in `~/.config/gnar-term/team-history.json`
- Viewable via command palette: "View Team History"

---

## Implementation Plan

### Phase 1 Implementation (MVP)

#### Step 1: Config Schema Extension

**Files:** `src/config.ts`

Add types:

```typescript
export interface AgentDef {
  name: string;
  role: "lead" | "teammate";
  command?: string;  // override CLI command
}

export interface TeamDef {
  name: string;
  agents: AgentDef[];
}

export interface CommandDef {
  // ... existing fields ...
  team?: TeamDef;  // NEW: associate command with a team
}
```

Update `loadConfig()` to parse team definitions.

#### Step 2: Tmux Shim Script

**Files:** new `src-tauri/resources/tmux-shim.sh`

Write a shell script (~200-300 lines) that:
- Parses tmux CLI arguments (split-window, send-keys, capture-pane, list-panes, etc.)
- Translates them into JSON-RPC requests
- Sends requests to gnar-term's Unix socket at `$GNARTERM_SOCKET_PATH`
- Returns tmux-compatible output (e.g., `list-panes` format: `%0: [80x24] [history 0/5000]`)

Key commands to implement:
- `split-window [-h|-v] [command]` → `{"method":"pane.split","params":{"direction":"h|v","command":"..."}}`
- `send-keys "text" [Enter]` → `{"method":"pty.write","params":{"text":"..."}}`
- `capture-pane -p` → `{"method":"pane.capture","params":{}}`
- `select-pane -t N` → `{"method":"pane.focus","params":{"index":N}}`
- `kill-pane` → `{"method":"pane.close","params":{}}`
- `list-panes` → `{"method":"pane.list","params":{}}`
- `display-message` → `{"method":"notify","params":{"text":"..."}}`

The shim is bundled as a Tauri resource and written to `~/.config/gnar-term/bin/tmux` at startup.

#### Step 3: Socket Server (Rust Backend)

**Files:** `src-tauri/src/lib.rs` (or new `src-tauri/src/socket.rs`)

Add a Unix domain socket server that:
- Listens at a path stored in `$GNARTERM_SOCKET_PATH` (e.g., `/tmp/gnar-term-{pid}.sock`)
- Accepts JSON-RPC requests from the tmux shim
- Dispatches to existing Tauri commands (spawn_pty, write_pty, resize_pty, kill_pty)
- For pane operations (split, focus, close), emits Tauri events that the frontend handles
- Returns JSON-RPC responses with results (pane IDs, terminal content, etc.)

New Tauri events:
- `shim-split-pane` → frontend creates new pane + surface
- `shim-focus-pane` → frontend switches active pane
- `shim-close-pane` → frontend removes surface
- `shim-capture-pane` → frontend reads terminal buffer, returns via command

#### Step 4: Team Workspace Spawning

**Files:** `src/terminal-manager.ts`

Add `createTeamWorkspace(teamDef, workspaceDef)`:

1. Call existing `createWorkspaceFromDef()` to build initial layout (lead pane only)
2. Tag the workspace as a team workspace (add `teamId?: string` to `Workspace` interface)
3. Set environment for the lead PTY: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `PATH` with shim prepended, `GNARTERM_SOCKET_PATH`
4. Spawn `claude --teammate-mode tmux` in the lead pane
5. Listen for `shim-split-pane` events — create new panes/surfaces as Claude Code spawns teammates
6. Tag each shim-created surface with agent metadata (`agentName`, `agentRole`)

Also add `watch_directory(path)` Rust command for `~/.claude/teams/{team-name}/` to track team state changes (task updates, teammate status).

#### Step 5: Shim Event Handlers (Frontend)

**Files:** `src/terminal-manager.ts`

Listen for shim events and translate to terminal-manager operations:

```typescript
listen("shim-split-pane", ({ direction, command }) => {
  const ws = this.activeWorkspace;
  const pane = this.activePane;
  this.splitPane(direction === "h" ? "horizontal" : "vertical");
  // New pane is now active; write command if provided
  if (command) invoke("write_pty", { ptyId: newSurface.ptyId, data: command + "\n" });
});
```

#### Step 4: Sidebar Agent Metadata

**Files:** `src/sidebar.ts`

In the workspace item render:
- Check if workspace has `teamId`
- If so, show agent count badge
- Show aggregate status (idle/working/waiting) based on surface notification state
- Color-code the workspace border by team status

#### Step 5: Command Palette Commands

**Files:** `src/command-palette.ts`

Add commands dynamically from config:
- "Launch Team: {name}" for each team in config
- "Pause Team" / "Resume Team" / "Kill Team" for active team workspaces
- Wire to `TerminalManager` methods that iterate team surfaces and send signals

#### Step 6: Context Menu Extensions

**Files:** `src/context-menu.ts`, `src/terminal-manager.ts`

Add agent-specific menu items when right-clicking a surface that has `agentRole`:
- "Interrupt Agent" → write Escape key to PTY
- "Kill Agent" → kill_pty

Add team-specific menu items when right-clicking a team workspace in sidebar.

#### Step 7: Notification Mapping

**Files:** `src/terminal-manager.ts`

Extend `pty-notification` handler:
- Parse notification text for Claude Code status patterns (permission request, error, completion)
- Set `surface.notificationType` (info/warn/error/success)
- Sidebar and tab bar render different colors per type

---

### Phase 2 Implementation

#### Step 8: Agent Panel Surface Type

**Files:** `src/terminal-manager.ts`, new `src/agent-panel.ts`

- New surface type with `terminal: null`, custom `termElement`
- Polls team files on interval (or via file watcher)
- Renders agent grid table with status, task, tokens
- Auto-opens as a tab in the lead pane when a team workspace launches

#### Step 9: Task List Previewer

**Files:** new `src/preview/tasks.ts`, `src/preview/init.ts`

- Register previewer for `~/.claude/tasks/{team-name}/` directory
- Render task cards with status badges
- Use existing `watch_file` for live updates

#### Step 10: Session Log Previewer

**Files:** new `src/preview/agent-log.ts`, `src/preview/init.ts`

- Register previewer for `.jsonl` session files
- Parse JSONL, render tool calls with collapsible detail
- Syntax highlight code blocks in responses

---

### Phase 3 Implementation

#### Step 11: File Conflict Detection

**Files:** `src/terminal-manager.ts`

- Track per-surface CWD (already done via OSC 7)
- On `pty-output`, scan for common file operation patterns (`git checkout`, editor opens)
- If overlap detected, emit notification to sidebar

#### Step 12: Team History

**Files:** `src/config.ts`, new `src/team-history.ts`

- On team workspace close, snapshot: agents, duration, task outcomes
- Store in `~/.config/gnar-term/team-history.json`
- Command palette: "View Team History" opens preview surface

---

## Architecture Decisions

### Why watch files instead of hooking into Claude Code's IPC?

Claude Code's inter-agent coordination is entirely file-based (`~/.claude/teams/`, `~/.claude/tasks/`). There is no API server or WebSocket to connect to. File watching is the correct integration pattern — it's what Claude Code itself uses internally.

### Why the tmux shim pattern instead of a custom `--teammate-mode`?

Claude Code already knows how to talk to tmux. Rather than waiting for Anthropic to add a `--teammate-mode gnar-term`, we impersonate tmux via a shim script. This is exactly what cmux does — it's a proven pattern. Claude Code runs with `--teammate-mode tmux` and our shim translates commands to native gnar-term operations. Zero changes needed on the Claude Code side.

### Why surfaces instead of a separate UI layer?

Agent panels fit naturally into the existing surface/pane model. They can be tabbed, split, moved, and closed like any other surface. No new layout system needed.

### Why poll task files instead of using inotify/FSEvents?

The existing `watch_file` Rust command already polls at 500ms intervals. This is fast enough for agent status updates and avoids platform-specific filesystem notification complexity. Can upgrade to FSEvents/inotify later if needed.

---

## Open Questions

1. **Auto-spawn vs config-driven:** Should gnar-term auto-detect when Claude Code creates a team and spawn panes, or require explicit config? (Recommendation: support both — config for planned teams, auto-detect for ad-hoc)

2. **Telemetry access:** Claude Code pipes telemetry to `~/.claude/claudetop.d/` scripts. Should gnar-term install a script there, or read session JSONL files directly? (Recommendation: install a lightweight telemetry collector script)

3. **Permission handling:** When an agent needs approval, should gnar-term auto-focus that pane? (Recommendation: yes, with a setting to disable)

4. **Max agents:** Should there be a limit on simultaneous agent panes? (Recommendation: no hard limit, but warn at >6 agents about performance)

---

## References

- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks)
- [cmux claude-teams PR #1179](https://github.com/manaflow-ai/cmux/pull/1179) — tmux shim implementation
- [cmux Socket API](https://cmux.com/docs/automation/socket-api)
- [Claude Code Agent Teams architecture (reverse-engineered)](https://dev.to/nwyin/reverse-engineering-claude-code-agent-teams-architecture-and-protocol-o49)
- [Claude Code issue #36926: Support cmux as teammateMode backend](https://github.com/anthropics/claude-code/issues/36926)
