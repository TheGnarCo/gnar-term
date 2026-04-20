# Competitive Landscape — Reference Seed

_Purpose: the raw input for competitive analyses. Tracks **competitors, sources, and
feature inventories** without reference to gnar-term. When producing a comparison
(`competitive-analysis.md`), start here — do not restate facts inline, cite this file._

## How to use

- **Adding a competitor**: new top-level section (`## <name>`). Populate the
  **Metadata**, **Feature inventory**, and **Sources** subsections. Mark the
  **Last verified** date. Paraphrase from primary sources; avoid marketing prose.
- **Updating a competitor**: increment **Last verified**, change only the lines that
  shifted, and note the change in the refresh log at the bottom.
- **Shape**: categorize into _terminal-first_, _orchestrator-first_, _vendor
  chrome_, or a new shape (note the reasoning).
- **No gnar-term comparisons here.** That framing lives in `competitive-analysis.md`.
- **Unknowns stay unknown.** Use `?` rather than guessing. Flag conflicting signals
  explicitly.

---

## cmux (manaflow-ai)

**Last verified:** 2026-04-20

### Metadata

| Field         | Value                                                 |
| ------------- | ----------------------------------------------------- |
| Vendor        | Manaflow                                              |
| Shape         | terminal-first                                        |
| Platforms     | macOS only                                            |
| License       | AGPL-3.0-or-later + paid commercial option            |
| Price         | Free (AGPL) · paid commercial tier (terms on request) |
| Account       | None required                                         |
| Agent support | Agent-agnostic (any CLI that runs in a PTY)           |
| Rendering     | libghostty (native Metal, GPU-accelerated)            |
| Distribution  | Native macOS app                                      |

### Feature inventory

- Vertical tabs sidebar with per-tab metadata: git branch, linked PR status/number,
  CWD, listening ports, last notification text.
- Notification rings via OSC 9 / 99 / 777 escape sequences — panes glow blue when an
  agent needs attention; unread badges in sidebar; macOS desktop notifications;
  `Cmd+Shift+U` jumps to most recent.
- Unix socket API + `cmux` CLI: agents can create workspaces/tabs, split panes, send
  keys, open URLs. An agent can spawn another via `cmux new-split` + `cmux send` +
  `cmux read-screen`.
- In-app scriptable browser (ported from agent-browser). Agents can snapshot the
  accessibility tree, click, fill forms, eval JS. Browser panes can route through
  SSH so localhost works remotely.
- `cmux.json` project-specific actions loadable from the command palette.
- Session restore (layout, CWDs, scrollback best-effort, browser history — not live
  processes).
- Inherits Ghostty config for themes.
- Command palette.
- Remote SSH workspaces — workspaces and the scriptable browser can target remote
  machines.

### Sources

- https://cmux.com/
- https://github.com/manaflow-ai/cmux
- https://manaflow-ai-cmux.mintlify.app/introduction

---

## Conductor (conductor.build)

**Last verified:** 2026-04-20

### Metadata

| Field         | Value                                                          |
| ------------- | -------------------------------------------------------------- |
| Vendor        | Conductor                                                      |
| Shape         | orchestrator-first                                             |
| Platforms     | macOS (Mac-only per product positioning)                       |
| License       | Proprietary, closed source                                     |
| Price         | Paid / freemium (see docs for current plans)                   |
| Account       | Uses existing Claude login (API key / Claude Pro / Claude Max) |
| Agent support | Claude Code + Codex                                            |
| Distribution  | Mac app                                                        |

### Feature inventory

- Spawns parallel Claude Code + Codex agents, each in its own git worktree.
- Heavy emphasis on **git worktree automation** as the core primitive — user never
  touches worktree plumbing.
- Dashboard view of all agents — who's working on what, review progress, merge.

### Sources

- https://www.conductor.build/
- https://docs.conductor.build

---

## Emdash (generalaction/emdash, YC W26)

**Last verified:** 2026-04-20

### Metadata

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Vendor        | General Action (YC W26)                                     |
| Shape         | orchestrator-first                                          |
| Platforms     | Cross-platform (Electron-class; Linux confirmed)            |
| License       | Open source                                                 |
| Price         | Free                                                        |
| Account       | None required; local-first (code/chats never leave machine) |
| Agent support | 20+ CLI agents (Claude Code, Codex, Gemini, …)              |
| Distribution  | Electron-class desktop app                                  |

### Feature inventory

- Open source, local-first — code and chats never leave your machine.
- Git worktree per agent (same primitive as Conductor/Superset).
- Issue-tracker integration: pulls issues from Linear, Jira, GitHub, GitLab
  directly; agents get full issue context.
- Kanban view of running agents (done / needs-input / in-progress).
- Built-in diff viewer + commit + push without switching tools.
- Remote SSH — run agents on a remote machine, worktree isolation preserved.
- "Run N copies of the same model to compare results side-by-side" — headline
  feature.

### Sources

- https://www.emdash.sh/
- https://github.com/generalaction/emdash
- https://news.ycombinator.com/item?id=45789262 (Show HN)

---

## Baton (getbaton.dev)

**Last verified:** 2026-04-20

### Metadata

| Field         | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| Vendor        | Baton (mraza007)                                                  |
| Shape         | orchestrator-first                                                |
| Platforms     | macOS / Windows / Linux                                           |
| License       | Proprietary                                                       |
| Price         | $49 one-time purchase (no subscription)                           |
| Account       | None required                                                     |
| Agent support | Claude Code · Codex CLI · OpenCode · Gemini CLI · custom commands |
| MCP           | Client (GUI setup for external MCP servers)                       |
| Distribution  | Desktop app                                                       |

### Feature inventory

- Git worktree per workspace. Toolbar for fetch / pull / rebase / push.
- **One-click PR open** to GitHub / GitLab.
- Monaco-powered diff viewer (split + unified). Per-file rollback. Compare against
  any branch.
- Full file tree with Monaco viewer for browsing.
- Multiple terminals per workspace — tabs, splits, drag-to-reorder, multi-line
  input, output search.
- "Open in VS Code / Cursor / Windsurf / Xcode" buttons.
- Autonomous mode polls GitHub Issues and spawns agents to work on them.
- MCP client with graphical setup.

### Sources

- https://getbaton.dev/
- https://github.com/mraza007/baton
- https://news.ycombinator.com/item?id=47599771 (Show HN)

---

## Superset (superset-sh)

**Last verified:** 2026-04-20

### Metadata

| Field         | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| Vendor        | superset-sh                                                       |
| Shape         | orchestrator-first / IDE-shaped                                   |
| Platforms     | macOS + Linux (some sources say macOS-only — conflicting signals) |
| License       | Open source                                                       |
| Price         | Free (use-your-own API keys)                                      |
| Account       | API keys                                                          |
| Agent support | Agent-agnostic (Claude Code, Codex, OpenCode, Cursor Agent, …)    |
| MCP           | Server (`superset-mcp` listed as connected server in UI)          |
| Distribution  | Desktop app                                                       |

### Feature inventory

- Positioned as "Code Editor for the AI Agents Era" — IDE-shaped, not
  terminal-shaped.
- 10+ agents at once, each in its own git worktree.
- Side-by-side and inline diff viewer.
- Built-in terminal, file tree, port forwarding.
- "Open in any IDE" (VS Code, Cursor, Xcode, JetBrains, Sublime Text, Terminal,
  Finder).
- MCP integration (lists `superset-mcp` as a connected server in UI).

### Sources

- https://superset.sh
- https://github.com/superset-sh/superset
- https://superset.sh/compare/superset-vs-opencode
- https://superset.sh/compare/best-ai-coding-agents-2026

---

## Claude Code Desktop (Anthropic)

**Last verified:** 2026-04-19 (from public docs and launch coverage)

### Metadata

| Field         | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| Vendor        | Anthropic                                                           |
| Shape         | vendor chrome (native chrome around one first-party agent)          |
| Platforms     | macOS (Intel + Apple Silicon), Windows (x64 + ARM64). **No Linux.** |
| License       | Proprietary, closed source                                          |
| Price         | Pro $20/mo · Max $100 or $200/mo · Team & Enterprise per-seat       |
| Account       | Required — Pro / Max / Team / Enterprise Anthropic account          |
| Agent support | Claude Code only (single vendor, single agent)                      |
| MCP           | Client + Connectors (graphical MCP server setup)                    |
| Distribution  | Signed installers from claude.com                                   |
| Relaunched    | 2026-04-14 (redesigned Desktop app)                                 |

### Feature inventory

- The **Code** tab inside the Claude Desktop app — not a separate binary. Graphical
  workspace on top of the Claude Code CLI.
- Drag-and-drop pane layout. Pane types: chat, diff, preview, integrated terminal,
  file editor, plan, tasks, subagent. Panes repositionable and resizable; `Cmd+\`
  closes focused pane. Views menu opens additional panes.
- Three transcript view modes (Normal / Verbose / Summary).
- Parallel sessions with auto git worktree isolation. Each new session gets its own
  worktree in `<project-root>/.claude/worktrees/` (location and branch prefix
  configurable). Sessions filterable and groupable by project / status / environment.
  Auto-archive after PR merge or close is a built-in setting. Worktree isolation
  requires Git (including on Windows).
- Built-in diff viewer with inline comments. Click any line, leave a comment, submit
  all comments with `Cmd+Enter`; Claude rereads the diff and responds. A **Review
  code** button asks Claude to evaluate its own diff before commit.
- CI status bar after PR open — polls `gh` results, with toggles for **auto-fix
  failing checks** and **auto-merge when green**.
- Live preview pane with a headless browser. Claude can spin up a dev server defined
  in `.claude/launch.json`, take screenshots, inspect DOM, click, fill forms,
  self-verify after edits (`autoVerify`). Also opens HTML / PDF / images.
- Side chats (`Cmd+;`) — branch off a question that uses session context but doesn't
  write back into the main thread.
- Computer use (research preview, Pro/Max only, macOS + Windows). Per-app permission
  tiers: view-only for browsers, click-only for terminals/IDEs, full control for
  everything else.
- Native MCP support + **Connectors** (MCP servers with graphical setup flow —
  GitHub, Slack, Linear, Notion, Calendar, …).
- **Plugins** (skills + agents + hooks + MCP + LSP) and **Skills** install from a
  marketplace inside the desktop app.
- **Routines** (research preview) — saved prompt + repo + connectors that run on
  schedule, API trigger, or GitHub events. Daily run caps scale by plan.
- **Dispatch** — send a task from the Claude phone app, get a Code session spawned
  on your desktop, optionally with computer use enabled.
- Cloud / remote execution — sessions can run on Anthropic's infrastructure (Remote
  sessions), or locally against an authenticated account.
- Remote SSH targeting Linux machines from Mac/Windows clients (client binary still
  doesn't run on Linux).
- **Relationship to the CLI**: Desktop is a graphical client over the same
  underlying Claude Code agent. The CLI still ships independently. Some CLI-only
  features remain (e.g., the `dontAsk` permission mode, several interactive-mode
  shortcuts).

### Research-preview caveats

- Routines, Computer Use, and the new Auto permission mode are labelled **research
  preview**. Gating and behavior may shift.

### Sources

- https://code.claude.com/docs/en/desktop
- https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/
- https://venturebeat.com/orchestration/we-tested-anthropics-redesigned-claude-code-desktop-app-and-routines-heres-what-enterprises-should-know
- https://thenewstack.io/claude-code-desktop-redesign/
- https://claude.com/pricing

---

## Shape taxonomy

| Shape              | Definition                                                                                                                                         | Current representatives            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Terminal-first     | Terminal emulator with first-class affordances for agents running inside it. Agents are CLI processes the user launches.                           | cmux                               |
| Orchestrator-first | Fleet manager for agent _processes_. Spawns N agents in isolated worktrees, tracks status in a dashboard, ships diff/PR/review UI. Agent-agnostic. | Conductor, Emdash, Baton, Superset |
| Vendor chrome      | Native desktop chrome around _one_ first-party agent. Parallel-worktree workflow + vendor-specific connectors and plugins. Account-gated.          | Claude Code Desktop                |

---

## Cross-cutting observations (no comparison, just patterns)

- **Worktree-per-agent is now table stakes** in orchestrator-first and
  vendor-chrome shapes. Every competitor in those categories ships it.
- **MCP is bifurcated into server and client roles.** Baton and Claude Code Desktop
  are MCP _clients_ consuming external servers. Superset exposes MCP _server_ tools.
  Conductor / Emdash don't currently advertise MCP at all.
- **Issue-tracker ingestion is converging on Linear + Jira + GitHub + GitLab.**
  Emdash supports all four; Baton autonomous mode + Claude Code Desktop Connectors
  add GitHub; Linear is the most commonly called-out non-GH source.
- **Auto-fix CI / auto-merge** is currently unique to Claude Code Desktop in this
  set. Baton ships one-click PR open but no post-PR automation.
- **Linux support is uneven.** Emdash and Baton ship Linux. cmux, Conductor, and
  Claude Code Desktop do not. Superset is ambiguous (sources conflict).
- **Account-gating split.** Claude Code Desktop requires a paid Anthropic account;
  Conductor uses Claude credentials but the app itself is gated; everyone else is
  bring-your-own-key or fully local.
- **Licensing split.** AGPL + commercial (cmux), open source (Emdash, Superset),
  proprietary paid (Baton one-time, Conductor subscription, Claude Code Desktop
  subscription).

---

## Refresh log

| Date       | Change                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| 2026-04-20 | Initial seed extracted from `competitive-analysis.md`. Six competitors tracked. |

---

## Secondary / context sources

Industry writing that informs how the shapes are categorized — not specific to any
single competitor:

- https://www.oreilly.com/radar/conductors-to-orchestrators-the-future-of-agentic-coding/
- https://addyosmani.com/blog/future-agentic-coding/
