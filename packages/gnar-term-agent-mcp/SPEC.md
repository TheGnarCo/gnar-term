# gnar-term-agent-mcp

MCP server for orchestrating AI coding agents via managed terminal sessions.

## Overview

gnar-term-agent-mcp turns your terminal into a programmable control plane for AI agent teams. A "manager" agent (e.g., Claude Code) can spawn, prompt, monitor, and coordinate multiple worker agents through MCP tool calls.

### Architecture

```
┌─────────────────────┐     stdio      ┌──────────────────────────┐
│   Claude Code       │◄──────────────►│  gnar-term-agent-mcp     │
│   (MCP client)      │                │  (MCP server)            │
└─────────────────────┘                └──────────────────────────┘
                                              │  │  │
                                         ┌────┘  │  └────┐
                                         ▼       ▼       ▼
                                       [PTY]   [PTY]   [PTY]
                                       bash    claude   codex
```

The server manages PTY sessions directly via `node-pty`. Each agent gets its own pseudo-terminal with output buffering, status tracking, and lifecycle management.

## Installation

```bash
cd packages/gnar-term-agent-mcp
npm install
npm run build
```

## Claude Code Configuration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "gnar-term": {
      "command": "node",
      "args": ["/absolute/path/to/packages/gnar-term-agent-mcp/dist/index.js"]
    }
  }
}
```

After restarting Claude Code, the 8 tools will be available.

## Tools

### Session Management

#### `spawn_agent`
Start an AI coding agent CLI in a managed terminal session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Human-readable session label |
| `agent` | enum | yes | `claude-code`, `codex`, `aider`, or `custom` |
| `task` | string | no | Initial prompt sent after 3s startup delay |
| `cwd` | string | no | Working directory |
| `command` | string | no | Shell command (required for `custom` agent) |
| `env` | object | no | Additional environment variables |
| `cols` | number | no | Terminal columns (default: 120) |
| `rows` | number | no | Terminal rows (default: 30) |

Returns: `{ session_id, name, agent, pid, status, cwd }`

#### `list_sessions`
List all active agent sessions. No parameters.

Returns: Array of session objects with id, name, agent, status, pid, cwd, createdAt.

#### `get_session_info`
Get detailed session info including output buffer stats.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID from spawn_agent |

#### `kill_session`
Terminate an agent session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID to terminate |
| `signal` | string | no | Signal name (default: SIGTERM) |

### Interaction

#### `send_prompt`
Send text input to a running agent, simulating user typing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Target session ID |
| `text` | string | yes | Text to send |
| `press_enter` | boolean | no | Append Enter keystroke (default: true) |

#### `send_keys`
Send control sequences or special keys.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Target session ID |
| `keys` | string | yes | Key name (see below) |

Available keys: `ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+l`, `ctrl+a`, `ctrl+e`, `ctrl+u`, `ctrl+k`, `enter`, `tab`, `escape`, `backspace`, `up`, `down`, `right`, `left`

#### `read_output`
Read recent terminal output from an agent session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Target session ID |
| `lines` | number | no | Number of recent lines (default: 50) |
| `cursor` | number | no | Return lines after this cursor (for polling) |
| `strip_ansi` | boolean | no | Strip ANSI codes (default: true) |

Returns: `{ output, cursor, total_lines, session_status }`

**Cursor-based polling:** Pass the `cursor` value from one read into the next call's `cursor` parameter to get only new output since your last read.

### Orchestration

#### `dispatch_tasks`
Spawn multiple agent sessions in parallel with individual tasks.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tasks` | array | yes | Array of task objects |

Each task object:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Session label |
| `agent` | enum | yes | Agent type |
| `task` | string | yes | Prompt to send |
| `cwd` | string | no | Working directory |
| `command` | string | no | For custom agents |

Returns: `{ dispatched, failed, sessions[] }`

## Usage Examples

### Spawn a bash session and interact with it
```
1. spawn_agent(name: "test", agent: "custom", command: "bash")
   → { session_id: "abc-123", pid: 12345 }

2. send_prompt(session_id: "abc-123", text: "ls -la")

3. read_output(session_id: "abc-123", lines: 20)
   → { output: "total 42\ndrwxr-xr-x ...", cursor: 15 }
```

### Dispatch parallel agents
```
dispatch_tasks(tasks: [
  { name: "auth", agent: "claude-code", task: "Implement login page", cwd: "/app" },
  { name: "signup", agent: "claude-code", task: "Implement signup page", cwd: "/app" },
  { name: "reset", agent: "claude-code", task: "Implement password reset", cwd: "/app" }
])
→ { dispatched: 3, failed: 0, sessions: [...] }
```

### Monitor agent progress with cursor polling
```
1. read_output(session_id: "abc-123")
   → { output: "...", cursor: 100 }

2. [wait]

3. read_output(session_id: "abc-123", cursor: 100)
   → { output: "[only new lines]", cursor: 150 }
```

## Session Status

Sessions transition through these states:
- `starting` — PTY spawned, waiting for first output
- `running` — Actively producing output
- `idle` — No output for 5s and last line looks like a prompt
- `exited` — Process terminated

## Design Notes

### Output Buffer
Each session maintains a 5000-line ring buffer. Output is captured raw and ANSI-stripped at read time. Partial lines (PTY chunks that don't end with newline) are included in reads as the last line.

### Process Cleanup
The server kills all managed PTY processes on SIGTERM, SIGINT, and normal exit. If the server crashes without running cleanup handlers, orphaned processes may persist.

### Future: gnar-term Integration
The PTY management layer is designed to be swappable. A future `GnarTermBridge` backend would communicate with the gnar-term Rust backend via Unix socket, enabling workspace management, visual notifications, and browser automation through the same MCP tool interface.
