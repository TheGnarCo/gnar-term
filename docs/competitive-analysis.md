# gnar-term vs. Agentic Orchestrators — Comparative Analysis

_Last updated: 2026-04-18_

## TL;DR

gnar-term and the tools the user named (cmux, Baton, Conductor, Emdash, Superset) all live in
the same neighborhood — "desktop app for developers working with AI coding agents" — but they
occupy **two different shapes** of the problem:

| Shape                  | What it is                                                                                                                                                                                                 | Representatives                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Terminal-first**     | A terminal emulator with first-class affordances for agents running inside it. Agents are CLI processes you launch yourself; the app gives them good ergonomics (notifications, layouts, scripting hooks). | **gnar-term**, **cmux**                            |
| **Orchestrator-first** | A fleet manager for agent _processes_. Spawns N Claude Codes / Codexes in isolated git worktrees, tracks their status in a dashboard, and ships diff/PR/review UI to merge their output.                   | **Conductor**, **Emdash**, **Baton**, **Superset** |

gnar-term is the only tool in the group that is **terminal-first, cross-platform, MIT, and exposes
an MCP surface so agents can programmatically drive the UI from inside the terminal they're running
in.** Everyone else is either Mac-only (cmux, Conductor), orchestrator-shaped (Conductor/Emdash/
Baton/Superset), paid (Baton), or some combination.

The most important framing: **gnar-term does not compete with Conductor/Emdash/Baton/Superset at
feature parity in the core app — it competes on a different axis.** Its closest cousin is cmux, and
the README is honest about that (gnar-term was built to have cmux's workflow on Linux, plus file
previews and a command palette).

**But gnar-term has a second axis that nobody else in the group has: the plugin axis.** It ships a
first-party **`agentic-orchestrator`** extension whose goal is to deliver the orchestrator-first
workflow — parallel agents, git worktrees, a fleet dashboard, diff viewer, PR flow, issue-tracker
ingestion — as an opt-in layer on top of the terminal-first core, without reshaping the core
itself. Today the extension ships passive agent detection and status tracking (v0.2.0); the
direction is full orchestration. That means **gnar-term is natively terminal-first but extensible
into full agentic orchestration** — a hybrid position none of the other five tools occupy.

---

## Category 1 — Terminal-first (gnar-term's shape)

### cmux (manaflow-ai)

The reference design. Native macOS, Swift + AppKit, built on `libghostty` for GPU-accelerated
rendering. Distinguishing features:

- **Vertical tabs sidebar** with per-tab git branch, linked PR status/number, CWD, listening ports,
  last notification text.
- **Notification rings**: OSC 9/99/777 escape sequences make panes glow blue when an agent needs
  attention; unread badges in sidebar; macOS desktop notifications; `Cmd+Shift+U` jumps to the most
  recent one.
- **Unix socket API + `cmux` CLI**: agents can create workspaces/tabs, split panes, send keys, open
  URLs. An agent can spawn another agent via `cmux new-split right` + `cmux send` + `cmux read-screen`.
- **In-app scriptable browser** (ported from agent-browser) — agents can snapshot the a11y tree,
  click, fill forms, eval JS. Browser panes can route through SSH so localhost works remotely.
- **cmux.json** project-specific actions loadable from the command palette.
- **Session restore** (layout, CWDs, scrollback best-effort, browser history — not live processes).
- License: **AGPL-3.0-or-later** with paid commercial option.
- Platforms: **macOS only**.

### gnar-term

- **Cross-platform** (macOS + Linux) via Tauri v2. Rust backend (`portable-pty`), Svelte frontend,
  xterm.js with WebGL renderer.
- **cmux-compatible config**: reads `cmux.json` / `~/.config/cmux/cmux.json` as-is. Settings schema
  is a superset — theme, `autoload`, surface types are additive.
- **Preview extension** (built-in, disableable in Settings → Extensions) — _not_ a core feature;
  shipped as an extension like everything else user-facing beyond the terminal itself. Click any
  path in the terminal → opens a tab that renders Markdown (GitHub CSS), PDF (pdf.js), CSV/TSV
  (sticky-header tables), images (incl. HEIC/AVIF/SVG), video, JSON/YAML/TOML, log/config. Live-
  reloads on disk change.
- **Command palette (⌘P)**: fuzzy-search commands, workspaces, themes, saved layouts.
- **11 themes** (6 dark, 5 light, incl. custom ones like Molly / Molly Disco). Instant switch,
  persisted to `settings.json`.
- **Binary-tree split panes**: each split chooses its own direction. Zoom (⇧⌘Enter), directional
  focus (⌥⌘↦), flash (⇧⌘H).
- **CWD tracking via OSC 7**: auto-installs zsh integration via `ZDOTDIR` shim; bash needs a single
  source line. New tabs/splits inherit active CWD.
- **Extension system**: sidebar tabs, surface types, commands, context menu items, overlays,
  workspace actions, settings pages. Preview, file browser, GitHub integration, project management
  are all built as extensions.
- **MCP integration (optional, agentic orchestration)**: ships an MCP server over a Unix domain
  socket (chmod 600, same-user trust boundary). Default `mcp: "auto"` auto-detects Claude Code and
  auto-registers via `claude mcp add-json`. Exposes ~20 tools:
  - Session: `spawn_agent`, `list_sessions`, `get_session_info`, `kill_session`
  - Interaction: `send_prompt`, `send_keys`, `read_output`
  - Orchestration: `dispatch_tasks`
  - UI writes: `render_sidebar`, `remove_sidebar_section`, `create_preview`
  - Agent introspection: `get_agent_context`
  - UI introspection: `get_active_workspace`, `list_workspaces`, `get_active_pane`, `list_panes`
  - Lifecycle: `poll_events`
  - Filesystem: `list_dir`, `read_file`, `file_exists`
  - Pane binding uses `GNAR_TERM_PANE_ID` / `GNAR_TERM_WORKSPACE_ID` env vars injected at PTY spawn
    — agents can never accidentally write into panes they don't own.
- **`agentic-orchestrator` extension** (built-in, disableable in Settings → Extensions): passive AI
  agent detector that watches every terminal across every workspace, matches PTY titles and
  streaming output against a pattern list (Claude Code, Codex, Aider, Cursor, GitHub Copilot + user
  patterns via `knownAgents`), and tracks each detected agent through `running` / `waiting` /
  `idle` / `closed` states. Renders per-surface tab dots + per-workspace indicators; surfaces with
  agents waiting on human input are marked unread. v0.2.0 today; designed as the hosting layer for
  the full orchestrator-first workflow (see _The plugin axis_ section below).
- License: **MIT**. Distribution: Homebrew cask, signed+notarized DMG (Apple Silicon + Intel),
  AppImage/deb/rpm.

### Head-to-head: gnar-term vs. cmux

| Axis                       | cmux                                 | gnar-term                                                               |
| -------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Platforms                  | macOS only                           | macOS + Linux                                                           |
| Rendering                  | libghostty (native Metal)            | xterm.js WebGL (webview)                                                |
| Config                     | `cmux.json`                          | reads `cmux.json`, adds `theme`/`autoload`/surface types                |
| Sidebar metadata           | git branch, PR, ports, notifications | workspaces + extensible via extensions                                  |
| Agent API                  | Unix socket + `cmux` CLI             | Unix socket + **MCP** (JSON-RPC 2.0)                                    |
| Agent spawning             | `cmux new-split` + `cmux send`       | `spawn_agent` MCP tool with deterministic pane binding                  |
| In-app browser             | Yes, scriptable                      | No (but file previews for MD/PDF/CSV/images/video)                      |
| OSC 9/99/777 notifications | Yes, first-class                     | Terminal renders escape sequences but no in-app notification ring (gap) |
| Extension system           | No                                   | Yes (sidebar/surface/command/context menu/overlay/workspace/settings)   |
| Themes                     | Inherits Ghostty config              | 11 built-in, switchable from palette                                    |
| Session restore            | Yes                                  | Partial (workspaces persist; scrollback doesn't)                        |
| License                    | AGPL-3.0-or-later + commercial       | MIT                                                                     |

**Where cmux wins**: native rendering performance (relevant for TUI-heavy workloads), first-class
PR-status-in-sidebar, scriptable browser, session restore, notification UI. Mature notification UX.

**Where gnar-term wins**: cross-platform, MCP integration instead of ad-hoc socket RPC, extension
system, a bundled Preview extension for agent-generated artifacts (docs, plots, PDFs), permissive
license.

---

## Category 2 — Orchestrator-first (different shape)

These are dashboard apps that spawn _many_ coding agents into _many_ isolated git worktrees, then
give you diff/PR/review UI to merge their output. They have terminals, but terminals are a
sub-feature — not the core abstraction. All four are Mac-focused; only Emdash and Baton ship Linux.

### Conductor (conductor.build)

- Mac app (Mac-only based on product positioning).
- Spawns parallel **Claude Code + Codex** agents, each in its own git worktree.
- Uses existing Claude login credentials (API key, Claude Pro, Claude Max).
- Dashboard view of all agents: who's working on what, review progress, merge.
- Heavy emphasis on **git worktree automation** as the core primitive — the user never touches
  worktree plumbing.
- Closed source, commercial.

### Emdash (generalaction/emdash, YC W26)

- **Open source**, local-first (code/chats never leave your machine).
- Cross-platform (not explicitly stated, but ships as an Electron-class app).
- **20+ CLI agents** supported (Claude Code, Codex, Gemini, …).
- **Git worktree per agent** (same primitive as Conductor/Superset).
- **Issue tracker integration**: pulls issues from Linear, Jira, GitHub, GitLab directly; agents
  get full issue context.
- **Kanban view** of running agents (done / needs-input / in-progress).
- **Built-in diff viewer** + commit + push without switching tools.
- **Remote SSH**: run agents on a remote machine, worktree isolation preserved.
- "Run N copies of the same model to compare results side-by-side" is a headline feature.

### Baton (getbaton.dev)

- **$49 one-time purchase** (no subscription). Proprietary.
- **macOS / Windows / Linux**.
- First-class support: Claude Code, Codex CLI, OpenCode, Gemini CLI + arbitrary custom commands.
- Git worktree per workspace. Toolbar for fetch/pull/rebase/push. **One-click PR open** to GitHub/
  GitLab.
- **Monaco-powered diff viewer** (split + unified). Per-file rollback. Compare against any branch.
- Full file tree with Monaco viewer for browsing.
- **Multiple terminals per workspace** with tabs + splits + drag-to-reorder + multi-line input +
  output search.
- "Open in VS Code / Cursor / Windsurf / Xcode" buttons.
- Autonomous mode polls GitHub Issues and spawns agents to work on them.

### Superset (superset-sh)

- **Free, open source, macOS + Linux** (some sources say macOS-only — conflicting signals).
- Positioned as a "Code Editor for the AI Agents Era" — IDE-shaped, not terminal-shaped.
- **10+ agents at once**, each in its own git worktree. Agent-agnostic (Claude Code, Codex,
  OpenCode, Cursor Agent, Gemini, …).
- **Side-by-side and inline diff viewer**.
- **Built-in terminal**, file tree, port forwarding.
- "Open in any IDE" (VS Code, Cursor, Xcode, JetBrains, Sublime Text, Terminal, Finder).
- **MCP integration** (lists `superset-mcp` as a connected server in their UI).
- Use-your-own-API-keys.

---

## The plugin axis: orchestrator-first _inside_ gnar-term

The "terminal-first vs. orchestrator-first" framing is a product-shape claim, not a cap on
functionality. gnar-term's built-in **`agentic-orchestrator`** extension is the path by which
orchestrator-first workflows become available without reshaping the core terminal.

**What it does today (v0.2.0 — passive detection).** On activation the extension bootstraps
tracking for every pre-existing terminal surface across all workspaces and panes, then subscribes
to `surface:created` / `surface:titleChanged` / `surface:closed` / output streams. It matches titles
and output against a pattern list (Claude Code, Codex, Aider, Cursor, GitHub Copilot + user-defined
`knownAgents`), and for each detected agent spins up a status tracker. OSC-notification-capable
agents feed directly into the tracker; the rest infer state from title + output activity + an
`idleTimeout` (configurable, default 30s). Status changes emit `extension:harness:statusChanged`,
which the extension consumes to render per-surface tab dots (`running`/`waiting`/`idle` variants) +
per-workspace indicators, and to mark `waiting` surfaces unread. Permissions: `observe` only. No
harness launching. No git worktree management. Purely observational.

**Why the hybrid works architecturally.** gnar-term's extension API already ships sidebar tabs,
surface types, commands, context menu items, overlays, workspace actions, and settings pages.
Internal agents can consume the same MCP tool surface external agents use (`spawn_agent`,
`send_prompt`, `read_output`, `render_sidebar`, `poll_events`, filesystem tools) with pane binding
enforced by the PTY-spawn env-var scheme. That means every orchestrator-first feature
Conductor/Emdash/Baton/Superset ship is expressible as extension surface + MCP tool calls:

| Orchestrator-first capability             | How it lands in the extension                                  |
| ----------------------------------------- | -------------------------------------------------------------- |
| Git worktree per spawned agent            | Wrap `spawn_agent` with worktree setup + cleanup               |
| Kanban / fleet-overview dashboard         | New sidebar tab rendering the agent registry                   |
| Diff viewer                               | New surface type (Monaco or native)                            |
| Issue-tracker ingestion (Linear / GH / …) | Commands that prompt-inject the issue body into a spawned pane |
| One-click PR open                         | Workspace action that shells `gh pr create` with the branch    |
| Per-workspace branch / PR status in rail  | Subscribe to `git_status` / `gh_list_prs` + write indicators   |

None of those require core changes. That's the architectural bet: **keep the core a great terminal
with an MCP surface; let extensions deliver every user-facing feature on top.** Preview, file
browser, GitHub integration, and project management are _already_ extensions in exactly the same
slot the orchestrator will occupy — so the `agentic-orchestrator` roadmap isn't speculative
architecture, it's the pattern gnar-term already runs on. Users who never enable the extension
never pay for its complexity; users who do get Conductor-class functionality without leaving their
terminal.

This also reframes how to read the feature matrix below: rows that gnar-term shows `❌` on —
worktree-per-agent, diff viewer, Kanban, issue-tracker integration, one-click PR — are not _core_
gaps. They're the `agentic-orchestrator` extension's forward roadmap.

---

## Feature Matrix

| Feature                                | gnar-term           | cmux                      | Conductor     | Emdash                 | Baton                                   | Superset         |
| -------------------------------------- | ------------------- | ------------------------- | ------------- | ---------------------- | --------------------------------------- | ---------------- |
| Shape                                  | terminal            | terminal                  | orchestrator  | orchestrator           | orchestrator                            | orchestrator/IDE |
| macOS                                  | ✅                  | ✅                        | ✅            | ✅                     | ✅                                      | ✅               |
| Linux                                  | ✅                  | ❌                        | ❌            | ✅                     | ✅                                      | ✅ (disputed)    |
| Windows                                | ❌                  | ❌                        | ❌            | ✅                     | ✅                                      | ❌               |
| License                                | MIT                 | AGPL-3.0 + comm.          | proprietary   | open source            | proprietary ($49)                       | open source      |
| Price                                  | free                | free                      | paid/freemium | free                   | $49 one-time                            | free             |
| Native rendering                       | xterm/WebGL         | libghostty/Metal          | —             | —                      | —                                       | —                |
| Terminal-first                         | ✅                  | ✅                        | ❌            | ❌                     | ❌ (rich terminals, but not primary)    | ❌               |
| Git worktree per agent                 | ❌                  | ❌                        | ✅            | ✅                     | ✅                                      | ✅               |
| Diff viewer                            | ❌                  | ❌                        | ✅            | ✅                     | ✅ (Monaco)                             | ✅               |
| PR open button                         | ❌                  | (PR status shown)         | ✅            | ✅                     | ✅                                      | ✅               |
| Issue tracker integration              | ❌                  | ❌                        | ?             | ✅ (Linear/Jira/GH/GL) | GH issues (autonomous mode)             | ❌               |
| Kanban/dashboard view                  | ❌                  | vertical tabs w/ status   | ✅            | ✅                     | ✅                                      | ✅               |
| File previews (MD/PDF/CSV/…)           | ✅                  | ❌                        | ❌            | ❌                     | ❌ (file viewer, not preview renderers) | ❌               |
| Embedded scriptable browser            | ❌                  | ✅                        | ❌            | ❌                     | ❌                                      | ❌               |
| MCP server surface                     | ✅ (20 tools)       | ❌                        | ❌            | ❌                     | ❌ (one-click MCP _client_ setup)       | ✅               |
| Unix socket agent API                  | ✅                  | ✅                        | ?             | ?                      | ?                                       | ?                |
| Agent → UI writes from inside terminal | ✅ (pane-bound MCP) | ✅ (CLI)                  | ❌            | ❌                     | ❌                                      | ❌               |
| Extension system                       | ✅                  | ❌                        | ❌            | ❌                     | ❌                                      | ❌               |
| Command palette                        | ✅                  | ✅                        | ?             | ?                      | ?                                       | ?                |
| Themes                                 | 11 built-in         | Ghostty config            | ?             | ?                      | ?                                       | ?                |
| Remote SSH                             | ❌                  | ✅ (workspaces + browser) | ❌            | ✅                     | ❌                                      | ❌               |
| Session restore                        | partial             | ✅                        | ?             | ?                      | ?                                       | ?                |
| OSC 9/99/777 notifications             | ❌ (gap)            | ✅                        | ❌            | ❌                     | ❌                                      | ❌               |

Legend: ✅ has it · ❌ doesn't · `?` unclear from public docs.

---

## Where gnar-term fits

### When to choose gnar-term

1. **You live on Linux** and want a cmux-style workflow. cmux is the reference design but is macOS-
   only; Conductor is macOS-only; Superset's Linux support is inconsistent. gnar-term is the
   first-class Linux option in the terminal-first category.
2. **You already have a `cmux.json`** and don't want to rewrite it. gnar-term reads it as-is.
3. **Your agents generate artifacts that need to be reviewed visually** — Markdown docs, PDFs,
   CSVs, plots, design screenshots. gnar-term's bundled Preview extension is the only thing in
   this category with first-class format-specific rendering. Orchestrators mostly assume the
   artifact is "a diff" and route you to a diff viewer.
4. **You want agents that can drive the workspace UI from inside the terminal they're running in**.
   gnar-term's MCP surface (with deterministic pane binding via `GNAR_TERM_PANE_ID`) is
   architecturally the cleanest expression of this in the group. cmux has a Unix socket CLI; no one
   else ships this model.
5. **You're building extensions**. gnar-term is the only tool in the set with a documented
   extension API across surfaces/commands/sidebar/context-menu/settings-pages.
6. **You want MIT-licensed, self-hostable, no-account-required.**

### When to choose something else

1. **You're running ≥10 agents in parallel on different tasks and need a fleet dashboard.** Use
   Conductor, Emdash, Baton, or Superset. gnar-term doesn't do git-worktree-per-agent and doesn't
   give you a Kanban view of "who's done / who needs input".
2. **Your workflow is "file an issue, let the agent fix it, review the PR".** Emdash (Linear/Jira/
   GH/GL) and Baton (GH issues autonomous mode) are purpose-built for this.
3. **You want a polished Monaco diff viewer with per-file rollback, branch comparisons, and one-
   click PR creation.** Baton.
4. **You're macOS-only and want native Metal rendering performance.** cmux.
5. **You need a scriptable in-app browser** (agent-driven web automation). cmux is the only option.

### Gaps to close — split by layer

Because gnar-term is a terminal core + an orchestrator extension, gap-closing splits cleanly into
two tables. Plugin-layer items don't require core changes; core-layer items do.

**`agentic-orchestrator` extension roadmap (plugin-layer, opt-in)**

| Capability                                            | Tool that has it                   | In v0.2.0?   | Effort                                                    |
| ----------------------------------------------------- | ---------------------------------- | ------------ | --------------------------------------------------------- |
| Passive agent detection + per-surface status dots     | cmux (via OSC)                     | ✅           | shipped                                                   |
| Git worktree per spawned agent                        | Conductor, Emdash, Baton, Superset | ❌ (roadmap) | Wrap `spawn_agent` with worktree setup. Medium.           |
| Kanban / fleet-overview sidebar tab                   | Conductor, Emdash, Baton           | ❌           | Agent registry is already there; needs a sidebar surface. |
| Diff viewer surface                                   | Baton, Superset, Emdash            | ❌           | New surface type. Medium.                                 |
| Issue-tracker ingestion (Linear / GH / Jira / GitLab) | Emdash, Baton                      | ❌           | Commands + extension settings. Medium.                    |
| One-click PR open                                     | Baton, Superset, Emdash            | ❌           | Workspace action shelling `gh pr create`. Low.            |
| Per-workspace git branch / PR status in sidebar       | cmux, all orchestrators            | ❌           | Reuse existing `gh_list_prs` / `git_status`. Low.         |

**Core-app gaps (would live outside the plugin)**

| Gap                                                      | Tool that has it | Effort                                                        |
| -------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| OSC 9/99/777 notification UI (pane ring, desktop notify) | cmux             | Terminal escape handling + UI overlay. Medium.                |
| Session restore (scrollback / processes)                 | cmux             | PTY serialization. High (processes can't really be restored). |
| Embedded scriptable browser                              | cmux             | Webview-in-webview. Hard in Tauri. High.                      |
| Remote SSH workspaces                                    | cmux, Emdash     | Config + PTY over SSH. High.                                  |

### Where gnar-term already has an edge

- **Extension model** (no competitor ships this) — and the core already dogfoods it: Preview,
  GitHub, file browser, project management, and agentic-orchestrator are all extensions, not
  core features.
- **MCP-as-primary agent API** with deterministic pane binding (cleaner than cmux's ad-hoc socket).
- **Preview extension** rendering MD/PDF/CSV/images/video/JSON/YAML/TOML/logs (nobody else ships
  format-specific preview renderers of this breadth).
- **Cross-platform parity** in the terminal-first category.
- **MIT license** (vs. AGPL for cmux, proprietary for Conductor/Baton).
- **cmux-config compatibility** — gnar-term is the only tool that lets a cmux user migrate without
  rewriting config.

---

## Positioning statement (suggested)

> gnar-term is a cross-platform, MIT-licensed terminal workspace manager for developers running AI
> coding agents. The core is deliberately small — a great terminal, a command palette, 11 themes,
> and an MCP surface with deterministic pane binding so agents can drive the UI from inside the
> terminal they're running in. Everything else users see is an extension: the bundled Preview
> extension renders MD/PDF/CSV/images/video; GitHub, file browser, and project management are
> extensions too. The `agentic-orchestrator` extension is the opt-in layer that brings
> orchestrator-first functionality — parallel agents in isolated worktrees, diff viewers, Kanban
> dashboards, one-click PRs, issue-tracker ingestion — into the same terminal, hosted entirely by
> the extension API and the MCP tool surface. If cmux is the macOS-native reference design for the
> terminal-first half, gnar-term is the cross-platform MCP-native cousin whose extension model
> gives it the plugin-extensible path into the orchestrator-first half.

---

## Sources

- [cmux — The terminal built for multitasking](https://cmux.com/)
- [manaflow-ai/cmux on GitHub](https://github.com/manaflow-ai/cmux)
- [cmux Introduction (mintlify docs)](https://manaflow-ai-cmux.mintlify.app/introduction)
- [Conductor — Run a team of coding agents on your Mac](https://www.conductor.build/)
- [Conductor docs](https://docs.conductor.build)
- [Emdash homepage](https://www.emdash.sh/)
- [generalaction/emdash on GitHub](https://github.com/generalaction/emdash)
- [Emdash on Hacker News (Show HN)](https://news.ycombinator.com/item?id=45789262)
- [Baton — A Desktop App for Developing with AI Agents](https://getbaton.dev/)
- [Baton on Hacker News (Show HN)](https://news.ycombinator.com/item?id=47599771)
- [mraza007/baton on GitHub](https://github.com/mraza007/baton)
- [Superset — Run 10+ parallel coding agents](https://superset.sh)
- [superset-sh/superset on GitHub](https://github.com/superset-sh/superset)
- [Superset vs OpenCode comparison](https://superset.sh/compare/superset-vs-opencode)
- [Superset: Best AI Coding Agents 2026](https://superset.sh/compare/best-ai-coding-agents-2026)
- [Conductors to Orchestrators (O'Reilly Radar)](https://www.oreilly.com/radar/conductors-to-orchestrators-the-future-of-agentic-coding/)
- [The future of agentic coding — Addy Osmani](https://addyosmani.com/blog/future-agentic-coding/)
