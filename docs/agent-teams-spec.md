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

### What cmux Does

cmux's `claude-teams` command spawns Claude Code teammates as native terminal splits. Each gets a pane with sidebar metadata and notification badges. No tmux required.

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

#### 1.2 Team Spawning

When a team workspace launches:

1. Spawn the lead Claude Code session in the first pane
2. The lead creates teammates via its own Agent Teams mechanism
3. gnar-term watches `~/.claude/teams/{team-name}/config.json` for new teammates
4. As teammates appear in config, gnar-term spawns their terminal panes automatically
5. Each teammate pane runs its Claude Code CLI process

**Alternative (simpler):** gnar-term spawns all processes directly:
- Lead pane: `claude --teammate-mode in-process`
- Teammate panes: spawned by the lead, gnar-term just provides the terminal

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

#### Step 2: Team Workspace Spawning

**Files:** `src/terminal-manager.ts`

Add `createTeamWorkspace(teamDef, workspaceDef)`:

1. Call existing `createWorkspaceFromDef()` to build the layout
2. Tag the workspace as a team workspace (add `teamId?: string` to `Workspace` interface)
3. For each surface, store the agent name/role (add `agentName?: string`, `agentRole?: string` to `Surface` interface)
4. If a surface has a `command` in config, write it to the PTY after spawn

#### Step 3: Team File Watcher

**Files:** `src-tauri/src/lib.rs`, `src/terminal-manager.ts`

Add Rust command `watch_directory(path)` that emits events when files in `~/.claude/teams/{team-name}/` change.

Frontend listener reacts to config changes:
- New teammate appears → spawn new surface in team workspace
- Teammate removed → mark surface as exited

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

### Why not use Claude Code's `--teammate-mode tmux`?

gnar-term replaces tmux. The whole point is to provide a native GUI alternative. We use `--teammate-mode in-process` (or spawn teammates directly) and let gnar-term handle the pane layout.

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
