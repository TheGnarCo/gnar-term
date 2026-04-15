# gnar-term-agent-mcp

MCP server for orchestrating AI coding agents inside real Gnar Term panes.

## Overview

gnar-term-agent-mcp is the bridge between an MCP client (e.g. Claude Code) and Gnar Term. A manager agent can spawn worker agents into real, visible Gnar Term panes; prompt them; read their output; and kill them — all through MCP tool calls.

### Architecture

```
┌─────────────────┐   stdio MCP    ┌────────────────────────┐   bridge WS    ┌──────────────────┐
│   Claude Code   │◄──────────────►│  gnar-term-agent-mcp   │◄──────────────►│   Gnar Term app  │
│   (MCP client)  │                │  (sidecar, stdio srvr) │                │   (Rust + webview)│
└─────────────────┘                └────────────────────────┘                └──────────────────┘
                                                                                      │
                                                                                      ▼
                                                                              [Gnar Term panes]
                                                                                    (PTYs)
```

Two wires:

1. **stdio MCP** between Claude Code and the sidecar (standard MCP transport).
2. **Internal bridge WebSocket** between the sidecar and the Gnar Term webview (app-local, not exposed to agents or clients).

The sidecar is stateless. It owns no PTYs, no session records, no output buffers. Every tool call forwards to the webview via the bridge; the webview is the authority for panes, PTYs, session state, and output buffering.

### Processes and lifecycle

- **Sidecar** — a Node process spawned by the MCP client (Claude Code). Speaks stdio MCP on its input/output streams and hosts a localhost WebSocket server on an ephemeral port. Writes that port to `~/.config/gnar-term/mcp-bridge.port` so the Gnar Term webview can find it.
- **Gnar Term webview** — connects to the sidecar's WS as a client on startup. Registers handlers for each bridge op.
- **Connection model** — the sidecar has zero or one connected client at a time (a single Gnar Term window). If no webview is connected when an MCP tool is called, the tool returns an error telling the user to open Gnar Term.

## Installation

```bash
cd packages/gnar-term-agent-mcp
npm install
npm run build
```

## Claude Code configuration

```bash
claude mcp add -s user gnar-term node /absolute/path/to/packages/gnar-term-agent-mcp/dist/index.js
```

After restarting Claude Code, the 8 tools are available.

## Bridge protocol

WebSocket messages are JSON. Three message types.

### Request (sidecar → webview)

```json
{ "type": "request", "id": "req-123", "op": "spawn_pane", "params": { "...": "..." } }
```

### Response (webview → sidecar)

```json
{ "type": "response", "id": "req-123", "result": { "...": "..." } }
```

Or:

```json
{ "type": "response", "id": "req-123", "error": "message" }
```

### Bridge ops

Each bridge op corresponds to one MCP tool. Ops are implemented in the webview and dispatched to existing pane-service / Tauri-command logic.

| Op | Params | Result |
|---|---|---|
| `spawn_pane` | `{ name, agent, task?, cwd?, command?, env?, cols?, rows? }` | `{ session_id, name, agent, pid, cwd }` |
| `list_sessions` | `{}` | Array of `{ session_id, name, agent, pid, status, cwd, createdAt }` |
| `get_session_info` | `{ session_id }` | Session object with `bufferStats: { cursor, lastLine }` |
| `kill_session` | `{ session_id, signal? }` | `{ ok: true }` |
| `send_prompt` | `{ session_id, text, press_enter? }` | `{ ok: true }` |
| `send_keys` | `{ session_id, keys }` | `{ ok: true }` |
| `read_output` | `{ session_id, lines?, cursor?, strip_ansi? }` | `{ output, cursor, total_lines, session_status }` |
| `dispatch_tasks` | `{ tasks: [...] }` | `{ dispatched, failed, sessions[] }` |

Session IDs are opaque strings assigned by the webview. The webview maps a session_id to the underlying Gnar Term pane and its Tauri PTY.

## Tools

### Session management

#### `spawn_agent`
Create a new Gnar Term pane running an AI coding agent CLI.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Human-readable session label |
| `agent` | enum | yes | `claude-code`, `codex`, `aider`, or `custom` |
| `task` | string | no | Initial prompt sent after 3s startup delay |
| `cwd` | string | no | Working directory |
| `command` | string | no | Shell command (required for `custom` agent) |
| `env` | object | no | Additional environment variables |
| `cols` | number | no | Terminal columns (default: from webview fit) |
| `rows` | number | no | Terminal rows (default: from webview fit) |

Returns: `{ session_id, name, agent, pid, status, cwd }`

The pane appears in the current active workspace. The user sees it immediately.

#### `list_sessions`
List all MCP-spawned sessions currently alive in Gnar Term. No parameters.

#### `get_session_info`
Detailed session info including output buffer stats.

| Parameter | Type | Required |
|-----------|------|----------|
| `session_id` | string | yes |

#### `kill_session`
Terminate a session and close its pane.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Session ID |
| `signal` | string | no | Signal name (default: SIGTERM) |

### Interaction

#### `send_prompt`
Send text input to a session, simulating user typing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Target session |
| `text` | string | yes | Text to send |
| `press_enter` | boolean | no | Append Enter (default: true) |

#### `send_keys`
Send control sequences or special keys.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Target session |
| `keys` | string | yes | Key name |

Available keys: `ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+l`, `ctrl+a`, `ctrl+e`, `ctrl+u`, `ctrl+k`, `enter`, `tab`, `escape`, `backspace`, `up`, `down`, `right`, `left`

#### `read_output`
Read recent terminal output from a session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | yes | Target session |
| `lines` | number | no | Number of recent lines (default: 50) |
| `cursor` | number | no | Return lines after this cursor (for polling) |
| `strip_ansi` | boolean | no | Strip ANSI codes (default: true) |

Returns: `{ output, cursor, total_lines, session_status }`

**Cursor-based polling:** pass the returned `cursor` into the next call to get only new output.

### Orchestration

#### `dispatch_tasks`
Spawn multiple agent panes in parallel.

| Parameter | Type | Required |
|-----------|------|----------|
| `tasks` | array | yes |

Each task: `{ name, agent, task, cwd?, command?, env? }`.

Returns: `{ dispatched, failed, sessions[] }`

## Session status

- `starting` — pane created, PTY spawned, no output yet
- `running` — actively producing output
- `idle` — no output for 5s and the last line looks like a shell prompt
- `exited` — PTY exited

Status is derived and tracked by the webview.

## Testing

`npm test` runs the integration test (`test-mcp.mjs`). The test spawns the sidecar, attaches a mock WebSocket client that responds to bridge requests with canned data, and exercises every tool over stdio MCP. No Gnar Term instance required.

For end-to-end verification against a real app: launch Gnar Term (`npm run tauri dev`), register the sidecar with Claude Code, and call a tool.

## Design notes

### Output buffering

Output for each MCP-spawned pane is buffered in the webview by the `MCPOutputBuffer` service, which taps the existing `pty-output` Tauri event stream. The buffer is a line-indexed ring with a 5000-line capacity, configurable. `read_output` supports cursor-based polling so callers don't miss lines between reads.

### Why in-webview buffering

xterm.js's built-in scrollback is optimized for visual display, not programmatic reads. Wrapping it for structured queries (line count, ANSI stripping, cursor tracking) is clunkier than maintaining a parallel plain-text buffer. The parallel buffer is cheap because Tauri's `pty-output` event already streams base64-encoded raw bytes to the webview.

### Why the bridge is in the sidecar, not the Tauri backend

The sidecar is already a long-lived Node process that Claude Code spawns. Adding a WebSocket server to it is cheap. Hosting the bridge in Tauri would require spinning up a Rust WS server, running dispatch in either Rust or shuttled-to-webview handlers, and adds a language boundary for every new op. Keeping the bridge in the sidecar means:

- New ops are pure TypeScript on both sides.
- The Tauri backend stays focused on PTYs, panes, and OS integration.
- There is no Rust/TS split for extension authors to reason about.

### What happens when Gnar Term isn't running

Every tool returns an error immediately: "Gnar Term not connected. Open Gnar Term and try again." The sidecar does not queue requests or fall back to an in-process PTY. This is deliberate: the value of this MCP is integration with Gnar Term, so detachment from Gnar Term is a failure state.

### Process cleanup

The sidecar forwards SIGTERM/SIGINT cleanup to the webview (which owns the PTYs). If the sidecar crashes, the webview's PTYs survive — they are owned by the user's Gnar Term session, not the sidecar process.
