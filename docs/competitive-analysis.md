# gnar-term vs. Agentic Orchestrators — Comparative Analysis

_Last updated: 2026-04-19_

## TL;DR

gnar-term and the tools the user named (cmux, Baton, Conductor, Emdash, Superset, Claude Code
Desktop) all live in the same neighborhood — "desktop app for developers working with AI coding
agents" — but they occupy **three different shapes** of the problem:

| Shape                   | What it is                                                                                                                                                                                                                              | Representatives                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Terminal-first**      | A terminal emulator with first-class affordances for agents running inside it. Agents are CLI processes you launch yourself; the app gives them good ergonomics (notifications, layouts, scripting hooks).                              | **gnar-term**, **cmux**                            |
| **Orchestrator-first**  | A fleet manager for agent _processes_. Spawns N Claude Codes / Codexes in isolated git worktrees, tracks their status in a dashboard, and ships diff/PR/review UI to merge their output. Agent-agnostic.                                | **Conductor**, **Emdash**, **Baton**, **Superset** |
| **Vendor agent chrome** | Native desktop chrome around _one_ first-party agent. Drag-and-drop pane layout (chat / diff / preview / terminal / file), parallel sessions in worktrees, the agent vendor's connectors and plugin system, account-gated subscription. | **Claude Code Desktop**                            |

gnar-term is the only tool in the group that is **terminal-first, cross-platform, MIT, and exposes
an MCP surface so agents can programmatically drive the UI from inside the terminal they're running
in.** Everyone else is either Mac-only (cmux, Conductor), Mac-and-Windows-only (Claude Code
Desktop), orchestrator-shaped (Conductor / Emdash / Baton / Superset), single-vendor (Claude Code
Desktop is Claude-only), paid (Baton, Claude Code Desktop), or some combination.

The most important framing: **gnar-term does not compete with Conductor / Emdash / Baton / Superset
or Claude Code Desktop at feature parity in their own shape.** It competes on a different axis. Its
closest cousin is cmux, and the README is honest about that (gnar-term was built to have cmux's
workflow on Linux, plus file previews and a command palette). Its next-closest cousin in spirit is
Claude Code Desktop — both wrap a workspace UI around agentic workflows — but Claude Code Desktop
ships a fixed UI for one vendor's agent, whereas gnar-term ships an open terminal that any CLI
agent can run inside, plus an MCP surface those agents can drive.

**gnar-term has a second axis that nobody else in the group has: the plugin axis.** It ships a
first-party **`agentic-orchestrator`** extension whose goal is to deliver the orchestrator-first
workflow — parallel agents, fleet dashboard, diff surface, issue-tracker ingestion — as an opt-in
layer on top of the terminal-first core. Today the extension ships passive agent detection and
status tracking (v0.2.0); the direction is full orchestration.

The architecture has settled into a clear division of labor: **core owns the nouns, extensions
own the buttons.** Worktree workspaces, the git/PR/CI status rail, the GitHub integration that
backs PR badges, the worktree create/archive/merge lifecycle — all of these are core concepts.
Extensions like `worktree-workspaces` and `github-sidebar` are thin "control surfaces" that
expose user-facing entry points (a "New Worktree" button; a sidebar tab listing issues / PRs /
commits) and disappear cleanly when disabled, without taking the underlying capability with them.
The `agentic-orchestrator` extension consumes those core primitives directly — no cross-extension
coordination — which is why **gnar-term is natively terminal-first but extensible into full
agentic orchestration** without rebuilding the foundations.

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
- **Command palette (⌘P)**: fuzzy-search commands, workspaces, themes, saved layouts.
- **11 themes** (6 dark, 5 light, incl. custom ones like Molly / Molly Disco). Instant switch,
  persisted to `settings.json`.
- **Binary-tree split panes**: each split chooses its own direction. Zoom (⇧⌘Enter), directional
  focus (⌥⌘↦), flash (⇧⌘H).
- **CWD tracking via OSC 7**: auto-installs zsh integration via `ZDOTDIR` shim; bash needs a single
  source line. New tabs/splits inherit active CWD.
- **Worktree workspaces as a first-class core concept**: data model, lifecycle, archive / merge
  commands, `config.worktrees.settings` (branch prefix, copy patterns, setup script), and a
  distinctive 1px railColor border on worktree workspace items so they stand out in the sidebar.
  Project-nested worktrees inherit the project color automatically. Core also owns the
  `worktrees:create-workspace` command and the `worktree:merged` event other code can subscribe
  to (the bundled diff viewer does).
- **Git / GitHub status in core**: branch + ahead/behind + dirty + PR review + CI status render in
  the workspace subtitle directly from a core git status service. Gracefully degrades when `gh` is
  missing (no PR badge instead of an error). Polling is faster for the active workspace than for
  background ones.
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
- **Extension system**: sidebar tabs, surface types, commands, context menu items, overlays,
  workspace actions, settings pages, plus `runCommand(commandId, args?)` so extensions can trigger
  any registered core command. Eight included extensions (all `included: true`, all disableable in
  Settings → Extensions) ship on the same API third parties use:
  1. **`agentic-orchestrator`** — passive AI agent detector that watches every terminal across
     every workspace, matches PTY titles and streaming output against a pattern list (Claude Code,
     Codex, Aider, Cursor, GitHub Copilot + user patterns via `knownAgents`), and tracks each
     detected agent through `running` / `waiting` / `idle` / `closed` states. Renders per-surface
     tab dots + per-workspace indicators; surfaces with agents waiting on human input are marked
     unread. v0.2.0 today; designed as the hosting layer for the full orchestrator-first workflow.
  2. **`diff-viewer`** — diff surface + commands (uncommitted / staged / file diff / branch
     compare); subscribes to the core `worktree:merged` event to auto-refresh after a merge.
  3. **`file-browser`** — secondary sidebar tab showing the active terminal's directory tree.
  4. **`github-sidebar`** — secondary sidebar tab for GitHub issues / PRs / commits + a refresh
     action and `refresh-github` command. Owns _only_ the tab; the workspace-subtitle PR/CI badge
     is core and keeps working when this extension is disabled.
  5. **`jrvs-themes`** — Kirby-inspired theme pack.
  6. **`preview`** — file format renderers. Click any path in the terminal → opens a tab that
     renders Markdown (GitHub CSS), PDF (pdf.js), CSV/TSV (sticky-header tables), images (incl.
     HEIC/AVIF/SVG), video, JSON/YAML/TOML, log/config. Live-reloads on disk change.
  7. **`project-scope`** — workspace grouping into named projects with per-project sidebar
     sections and dashboard tabs.
  8. **`worktree-workspaces`** — owns _only_ the "New Worktree" workspace-action button. Its
     handler delegates to the core `worktrees:create-workspace` command via `runCommand`.
     Disabling the extension hides the button; the create flow stays palette-accessible.
- License: **MIT**. Distribution: Homebrew cask, signed+notarized DMG (Apple Silicon + Intel),
  AppImage/deb/rpm.

### Head-to-head: gnar-term vs. cmux

| Axis                       | cmux                                 | gnar-term                                                                   |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Platforms                  | macOS only                           | macOS + Linux                                                               |
| Rendering                  | libghostty (native Metal)            | xterm.js WebGL (webview)                                                    |
| Config                     | `cmux.json`                          | reads `cmux.json`, adds `theme`/`autoload`/surface types                    |
| Sidebar metadata           | git branch, PR, ports, notifications | workspaces + branch + dirty + PR + CI in core subtitle, extensions add tabs |
| Git worktree workflow      | not a primitive                      | first-class core: data model + lifecycle + archive/merge + visual border    |
| Agent API                  | Unix socket + `cmux` CLI             | Unix socket + **MCP** (JSON-RPC 2.0)                                        |
| Agent spawning             | `cmux new-split` + `cmux send`       | `spawn_agent` MCP tool with deterministic pane binding                      |
| In-app browser             | Yes, scriptable                      | No (but file previews for MD/PDF/CSV/images/video)                          |
| OSC 9/99/777 notifications | Yes, first-class                     | Terminal renders escape sequences but no in-app notification ring (gap)     |
| Extension system           | No                                   | Yes (sidebar/surface/command/context menu/overlay/workspace/settings)       |
| Themes                     | Inherits Ghostty config              | 11 built-in, switchable from palette                                        |
| Session restore            | Yes                                  | Partial (workspaces persist; scrollback doesn't)                            |
| License                    | AGPL-3.0-or-later + commercial       | MIT                                                                         |

**Where cmux wins**: native rendering performance (relevant for TUI-heavy workloads), scriptable
browser, session restore, mature OSC notification UX (pane ring + desktop notify).

**Where gnar-term wins**: cross-platform, MCP integration instead of ad-hoc socket RPC, extension
system, first-class worktree-workspace primitive, a bundled Preview extension for agent-generated
artifacts (docs, plots, PDFs), permissive license.

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

## Category 3 — Vendor agent chrome

A new shape since the previous revision of this doc. Native chrome built around _one_ first-party
agent, with the parallel-worktree workflow that orchestrators pioneered now folded directly into
the vendor's own client.

### Claude Code Desktop (Anthropic)

Anthropic relaunched a redesigned Claude Code Desktop on April 14, 2026. It's the **Code** tab
inside the Claude Desktop app — not a separate binary — and adds a graphical workspace on top of
the existing Claude Code CLI.

- **Platforms**: **macOS (Intel + Apple Silicon)** and **Windows (x64 + ARM64)**. **Linux is
  explicitly not supported.** SSH sessions let you target Linux machines from Mac/Windows but the
  client binary doesn't run on Linux.
- **Shape**: drag-and-drop pane layout. Pane types include chat, diff, preview, integrated
  terminal, file editor, plan, tasks, and subagent. Panes can be repositioned and resized; a
  Views menu opens additional panes; `Cmd+\` closes the focused one. Three transcript view modes
  (Normal / Verbose / Summary) control how much detail appears in the chat scrollback.
- **Parallel sessions with auto git worktree isolation**. Each new session gets its own worktree
  in `<project-root>/.claude/worktrees/` (location and branch prefix are configurable). Sessions
  can be filtered and grouped by project / status / environment in the sidebar. **Auto-archive
  after PR merge or close** is a built-in setting. Worktree isolation requires Git, including on
  Windows.
- **Single agent, single vendor**. Unlike orchestrators, Claude Code Desktop only runs Claude
  Code — no Codex, no Aider, no Gemini. Account-gated: requires Pro / Max / Team / Enterprise
  sign-in. **Pricing: Pro $20/mo, Max $100 or $200/mo, Team and Enterprise per-seat.** No free
  tier and no self-host option — sessions either run locally against an authenticated account, or
  on Anthropic's cloud infrastructure (Remote sessions).
- **Built-in diff viewer with inline comments**. Click any line, leave a comment, submit all
  comments with `Cmd+Enter`; Claude rereads the diff and responds. A **Review code** button asks
  Claude to evaluate its own diff before commit. After PR open, a CI status bar polls `gh`
  results, with toggles for **auto-fix failing checks** and **auto-merge when green**.
- **Live preview pane** with a headless browser. Claude can spin up a dev server defined in
  `.claude/launch.json`, take screenshots, inspect DOM, click, fill forms, and self-verify after
  edits (`autoVerify`). Also opens HTML / PDF / images directly.
- **Side chats** (`Cmd+;`) — branch off a question that uses session context but doesn't write
  back into the main thread.
- **Computer use** (research preview, Pro/Max only, macOS+Windows). Per-app permission tiers:
  view-only for browsers, click-only for terminals/IDEs, full control for everything else.
- **Native MCP support + Connectors**. Connectors are MCP servers with a graphical setup flow
  (GitHub, Slack, Linear, Notion, Calendar, …). Plugins (skills + agents + hooks + MCP +
  LSP) and Skills install from a marketplace inside the desktop app.
- **Routines** (research preview): a saved prompt + repo + connectors that run on a schedule, on
  API trigger, or on GitHub events. Daily run caps scale by plan.
- **Dispatch**: send a task from the Claude phone app, get a Code session spawned on your
  desktop, optionally with computer use enabled.
- **License**: closed source. Distribution: signed installers from claude.com.

The release also clarified the relationship to the **Claude Code CLI**, which still exists and
ships independently. Desktop is a graphical client over the same underlying Claude Code agent;
some CLI-only features remain (e.g., the `dontAsk` permission mode, several interactive-mode
shortcuts).

> _Public docs are recent as of 2026-04-19. Sources: Anthropic's `code.claude.com/docs/en/desktop`
> page, the April 14 launch coverage from MacRumors / VentureBeat / The New Stack, and the Claude
> pricing page. Some surfaces (Routines, Computer Use, the new Auto permission mode) are explicitly
> labelled research preview — gating and behavior may shift._

---

## The plugin axis: orchestrator-first _inside_ gnar-term

The "terminal-first vs. orchestrator-first vs. vendor-chrome" framing is a product-shape claim,
not a cap on functionality. gnar-term's built-in **`agentic-orchestrator`** extension is the path
by which orchestrator-first workflows become available without reshaping the core terminal.

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

**Why the hybrid works architecturally.** gnar-term's extension API ships sidebar tabs, surface
types, commands, context menu items, overlays, workspace actions, settings pages, and
`runCommand` (so extensions can trigger any registered core command, including `worktrees:
create-workspace`). Internal agents can consume the same MCP tool surface external agents use
(`spawn_agent`, `send_prompt`, `read_output`, `render_sidebar`, `poll_events`, filesystem tools)
with pane binding enforced by the PTY-spawn env-var scheme. The orchestrator-first capability set
lands by composing extension contributions with core commands and core events — the
agentic-orchestrator never has to reimplement the worktree lifecycle or the PR badge, because
core already owns both.

| Orchestrator-first capability             | How it lands                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git worktree per spawned agent            | Extension wraps `spawn_agent` around the core `worktrees:create-workspace` command (the same one the `worktree-workspaces` button calls); subscribes to `worktree:merged`. |
| Kanban / fleet-overview dashboard         | New sidebar tab rendering the agent registry.                                                                                                                              |
| Diff viewer                               | Bundled `diff-viewer` extension; subscribes to core `worktree:merged` to auto-refresh after merges.                                                                        |
| Issue-tracker ingestion (Linear / GH / …) | The bundled `github-sidebar` extension already lists issues/PRs; commands prompt-inject issue bodies into spawned panes.                                                   |
| One-click PR open                         | Workspace action that shells `gh pr create` with the current branch.                                                                                                       |
| Per-workspace branch / PR status in rail  | Already in core — the git status service writes branch + ahead/behind + dirty + PR + CI directly into the workspace subtitle through the workspace-subtitle registry.      |

The framing of this project has evolved alongside the architecture. The first cut was "core is a
great terminal with an MCP surface; let extensions deliver every user-facing feature on top."
That bet held while git status, the GitHub tab, and worktree management were themselves extensions.
As the agentic-orchestrator roadmap clarified what was actually load-bearing for that workflow,
those three moved into core — they were the primitives every other orchestration capability
depended on, and routing them through the extension barrier added coordination cost without buying
genuine pluggability.

The current arrangement adds one more piece of nuance: **bundled extensions are control surfaces
on top of core concepts.** `worktree-workspaces` doesn't own worktree workspaces — it owns the
"New Worktree" button. `github-sidebar` doesn't own the GitHub integration — it owns the issues /
PRs / commits tab. Disabling either one hides a UI affordance without taking the underlying
capability with it (the worktree create flow stays in the palette; the PR/CI badge in the
workspace subtitle keeps rendering). The revised bet is therefore: **core owns the nouns
(terminal, MCP, git/gh, worktree workspaces, the workspace status rail). Extensions own the
buttons that surface those nouns plus all genuinely additive features (preview renderers, file
browser, project grouping, diff viewer, theme packs, the agentic-orchestrator).** Users who never
enable a given extension never pay for its complexity; users who enable the agentic-orchestrator
get Conductor-class functionality without leaving their terminal, with the orchestrator extension
calling core directly for the heavy lifting.

This also reframes how to read the feature matrix below: rows that gnar-term shows `❌` on —
diff viewer surfaced as primary UI, Kanban, issue-tracker ingestion beyond a list view, one-click
PR — are not _core_ gaps. They're the `agentic-orchestrator` extension's forward roadmap, built on
the worktree/gh primitives core now ships.

---

## Feature Matrix

| Feature                                          | gnar-term           | cmux                      | Conductor     | Emdash                 | Baton                                   | Superset         | Claude Code Desktop                |
| ------------------------------------------------ | ------------------- | ------------------------- | ------------- | ---------------------- | --------------------------------------- | ---------------- | ---------------------------------- |
| Shape                                            | terminal            | terminal                  | orchestrator  | orchestrator           | orchestrator                            | orchestrator/IDE | vendor chrome                      |
| macOS                                            | ✅                  | ✅                        | ✅            | ✅                     | ✅                                      | ✅               | ✅                                 |
| Linux                                            | ✅                  | ❌                        | ❌            | ✅                     | ✅                                      | ✅ (disputed)    | ❌                                 |
| Windows                                          | ❌                  | ❌                        | ❌            | ✅                     | ✅                                      | ❌               | ✅ (x64 + ARM64)                   |
| License                                          | MIT                 | AGPL-3.0 + comm.          | proprietary   | open source            | proprietary ($49)                       | open source      | proprietary                        |
| Price                                            | free                | free                      | paid/freemium | free                   | $49 one-time                            | free             | $20/mo Pro · $100–$200/mo Max      |
| Account required                                 | ❌                  | ❌                        | login         | ❌                     | ❌                                      | API keys         | ✅ Anthropic acct.                 |
| Agent-agnostic                                   | ✅                  | ✅                        | Claude+Codex  | ✅ (20+ CLIs)          | ✅                                      | ✅               | ❌ (Claude only)                   |
| Native rendering                                 | xterm/WebGL         | libghostty/Metal          | —             | —                      | —                                       | —                | —                                  |
| Terminal-first                                   | ✅                  | ✅                        | ❌            | ❌                     | ❌ (rich terminals, but not primary)    | ❌               | ❌ (terminal is one pane of many)  |
| Worktree workspace primitive                     | ✅ (core)           | ❌                        | ✅            | ✅                     | ✅                                      | ✅               | ✅ (`.claude/worktrees/`)          |
| Git worktree per spawned agent                   | ⚠️ primitives only  | ❌                        | ✅            | ✅                     | ✅                                      | ✅               | ✅ (per session, automatic)        |
| Workspace status rail (branch + dirty + PR + CI) | ✅ (core)           | branch + PR (sidebar)     | ?             | ?                      | toolbar buttons                         | ?                | CI bar after PR open               |
| Diff viewer                                      | ✅ (extension)      | ❌                        | ✅            | ✅                     | ✅ (Monaco)                             | ✅               | ✅ (inline comments + auto-fix CI) |
| PR open / monitor                                | ❌                  | (PR status shown)         | ✅            | ✅                     | ✅ one-click                            | ✅               | ✅ open + auto-fix + auto-merge    |
| Issue tracker integration                        | ⚠️ GH list (ext.)   | ❌                        | ?             | ✅ (Linear/Jira/GH/GL) | GH issues (autonomous mode)             | ❌               | ✅ via Connectors (GH/Linear/…)    |
| Kanban/dashboard view                            | ❌                  | vertical tabs w/ status   | ✅            | ✅                     | ✅                                      | ✅               | session sidebar w/ filter+group    |
| File previews (MD/PDF/CSV/…)                     | ✅                  | ❌                        | ❌            | ❌                     | ❌ (file viewer, not preview renderers) | ❌               | ✅ (preview pane: HTML/PDF/img)    |
| Live app preview / dev-server browser            | ❌                  | scriptable browser        | ❌            | ❌                     | ❌                                      | ❌               | ✅ (headless browser + autoVerify) |
| Embedded scriptable browser                      | ❌                  | ✅                        | ❌            | ❌                     | ❌                                      | ❌               | ✅ (preview pane)                  |
| MCP server surface (host exposes tools)          | ✅ (~20 tools)      | ❌                        | ❌            | ❌                     | ❌ (MCP _client_ setup)                 | ✅               | ❌ (host is MCP _client_ only)     |
| MCP client (consume external MCP servers)        | n/a                 | n/a                       | ?             | ?                      | ✅                                      | ✅               | ✅ + Connectors GUI                |
| Unix socket agent API                            | ✅                  | ✅                        | ?             | ?                      | ?                                       | ?                | ❌                                 |
| Agent → UI writes from inside terminal           | ✅ (pane-bound MCP) | ✅ (CLI)                  | ❌            | ❌                     | ❌                                      | ❌               | n/a (single agent)                 |
| Extension / plugin system                        | ✅                  | ❌                        | ❌            | ❌                     | ❌                                      | ❌               | ✅ (Plugins + Skills marketplace)  |
| Command palette                                  | ✅                  | ✅                        | ?             | ?                      | ?                                       | ?                | slash commands + plugin browser    |
| Themes                                           | 11 built-in         | Ghostty config            | ?             | ?                      | ?                                       | ?                | system-driven                      |
| Remote SSH                                       | ❌                  | ✅ (workspaces + browser) | ❌            | ✅                     | ❌                                      | ❌               | ✅ (Mac/Linux targets)             |
| Cloud / remote execution                         | ❌                  | ❌                        | ❌            | ❌                     | ❌                                      | ❌               | ✅ (Anthropic-hosted)              |
| Scheduled agent runs                             | ❌                  | ❌                        | ❌            | ❌                     | ❌                                      | ❌               | ✅ (Routines, research preview)    |
| Computer use / GUI automation                    | ❌                  | ❌                        | ❌            | ❌                     | ❌                                      | ❌               | ✅ (research preview)              |
| Session restore                                  | partial             | ✅                        | ?             | ?                      | ?                                       | ?                | ✅ (session sidebar persists)      |
| OSC 9/99/777 notifications                       | ❌ (gap)            | ✅                        | ❌            | ❌                     | ❌                                      | ❌               | desktop notify on CI / Dispatch    |

Legend: ✅ has it · ❌ doesn't · ⚠️ partial · `?` unclear from public docs.

Notes on the partials:

- **Git worktree per agent (gnar-term)**: core ships `worktrees:create-workspace`, archive,
  merge, and the `worktree:merged` event, but does not yet auto-spawn or recycle worktrees per
  spawned agent — that's the agentic-orchestrator extension's roadmap.
- **Issue tracker integration (gnar-term)**: the bundled `github-sidebar` extension lists
  issues / PRs / commits via `gh`, but there's no one-click "ingest this issue and spawn an
  agent" flow yet (also orchestrator roadmap).
- **MCP server surface vs. MCP client**: gnar-term, cmux, and Claude Code Desktop sit on
  opposite sides of the MCP boundary. gnar-term and Superset _expose_ MCP tools to the agent
  running inside; Claude Code Desktop _consumes_ external MCP servers for connector-style
  integrations. They're complementary capabilities, not the same row even though both are
  labelled "MCP".

---

## Where gnar-term fits

### When to choose gnar-term

1. **You live on Linux** and want a cmux-style workflow. cmux is the reference design but is
   macOS-only; Conductor is macOS-only; Claude Code Desktop explicitly does not support Linux;
   Superset's Linux support is inconsistent. gnar-term is the first-class Linux option in the
   terminal-first category.
2. **You already have a `cmux.json`** and don't want to rewrite it. gnar-term reads it as-is.
3. **You don't want a single-vendor agent.** Claude Code Desktop only runs Claude. gnar-term runs
   any CLI agent you can launch in a terminal — Claude Code, Codex, Aider, Cursor, Gemini, custom
   shell scripts — and the agentic-orchestrator's pattern list extends to whatever you add.
4. **Your agents generate artifacts that need to be reviewed visually** — Markdown docs, PDFs,
   CSVs, plots, design screenshots. gnar-term's bundled Preview extension renders 47 file types
   directly in a pane. Claude Code Desktop's preview pane covers HTML / PDF / images only;
   orchestrators mostly assume the artifact is "a diff" and route you to a diff viewer.
5. **You want agents that can drive the workspace UI from inside the terminal they're running
   in.** gnar-term's MCP _server_ surface (with deterministic pane binding via `GNAR_TERM_PANE_ID`)
   is architecturally the cleanest expression of this in the group. cmux has a Unix socket CLI;
   Claude Code Desktop is an MCP _client_ that consumes external servers but doesn't expose its
   own UI as MCP tools; nobody else ships this model.
6. **You're building extensions.** gnar-term and Claude Code Desktop are the two tools in the
   set with documented plugin systems, but they're shaped differently — gnar-term's extensions
   are local Svelte modules with full sidebar / surface / command / context-menu access; Claude
   Code Desktop's plugins are marketplace packages of skills / agents / hooks / MCP servers
   scoped to the chat agent.
7. **You want MIT-licensed, self-hostable, no-account-required, no-subscription.**

### When to choose something else

1. **You're running ≥10 agents in parallel on different tasks and need a fleet dashboard.** Use
   Conductor, Emdash, Baton, or Superset. gnar-term doesn't auto-spawn worktrees per agent yet
   and doesn't give you a Kanban view of "who's done / who needs input".
2. **Your workflow is "file an issue, let the agent fix it, review the PR".** Emdash (Linear /
   Jira / GH / GL), Baton (GH issues autonomous mode), and Claude Code Desktop (Connectors +
   Routines + auto-merge) are purpose-built for this.
3. **You want Anthropic's first-party integrations and you're already paying for Claude Pro/Max.**
   Claude Code Desktop ships with Connectors (GitHub/Slack/Linear/Notion), the Plugins/Skills
   marketplace, Routines (scheduled runs), Dispatch (phone-spawned sessions), Computer Use, and a
   diff viewer with inline comments + auto-fix-CI / auto-merge. It's the densest single-vendor
   experience in the group, at the cost of being Claude-only and account-gated.
4. **You want a polished Monaco diff viewer with per-file rollback and one-click PR creation.**
   Baton.
5. **You're macOS-only and want native Metal rendering performance.** cmux.
6. **You need a scriptable in-app browser** (agent-driven web automation). cmux for a free
   scriptable browser tied to terminal panes; Claude Code Desktop for an integrated headless
   preview that also self-verifies edits.

### Gaps to close — split by layer

Because gnar-term is a terminal core + an orchestrator extension, gap-closing splits cleanly into
two tables. Plugin-layer items don't require core changes; core-layer items do.

**`agentic-orchestrator` extension roadmap (plugin-layer, opt-in)**

| Capability                                            | Tool that has it                                        | Status     | Effort                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| Passive agent detection + per-surface status dots     | cmux (via OSC)                                          | ✅ shipped | shipped (extension, v0.2.0)                                                                                      |
| Per-workspace git branch / PR / CI status in sidebar  | cmux, Claude Code Desktop, all orchestrators            | ✅ shipped | shipped in core (git status service writes the workspace subtitle)                                               |
| Worktree workspaces as a first-class concept          | Conductor, Emdash, Baton, Superset, Claude Code Desktop | ✅ shipped | shipped in core (data model + lifecycle + archive/merge + sidebar railColor border + `worktree:merged` event)    |
| Diff viewer surface                                   | Baton, Superset, Emdash, Claude Code Desktop            | ✅ shipped | shipped (bundled `diff-viewer` extension; subscribes to `worktree:merged`)                                       |
| GitHub issues / PRs / commits sidebar                 | Baton, Superset, Claude Code Desktop (Connectors)       | ✅ shipped | shipped (bundled `github-sidebar` extension consumes `gh`; PR/CI badge already in core subtitle)                 |
| New-worktree workspace-action button                  | Conductor, Emdash, Baton, Superset, Claude Code Desktop | ✅ shipped | shipped (bundled `worktree-workspaces` extension; delegates to core `worktrees:create-workspace`)                |
| Git worktree _per spawned agent_ (auto-orchestration) | Conductor, Emdash, Baton, Superset, Claude Code Desktop | ⚠️ near    | Wire `spawn_agent` to call `worktrees:create-workspace` via `runCommand`. Primitive is core-shipped; low effort. |
| Kanban / fleet-overview sidebar tab                   | Conductor, Emdash, Baton                                | ❌ roadmap | Agent registry is already there; needs a sidebar surface.                                                        |
| Issue-tracker ingestion (Linear / Jira / GitLab)      | Emdash, Baton, Claude Code Desktop                      | ❌ roadmap | Commands + extension settings; GitHub side is already covered by the `github-sidebar` extension.                 |
| One-click PR open                                     | Baton, Superset, Emdash, Claude Code Desktop            | ❌ roadmap | Workspace action shelling `gh pr create`. Low.                                                                   |

**Core-app gaps (would live outside the plugin)**

| Gap                                                      | Tool that has it                  | Effort                                                                  |
| -------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| OSC 9/99/777 notification UI (pane ring, desktop notify) | cmux                              | Terminal escape handling + UI overlay. Medium.                          |
| Session restore (scrollback / processes)                 | cmux, Claude Code Desktop         | PTY serialization. High (processes can't really be restored).           |
| Embedded scriptable / preview browser                    | cmux, Claude Code Desktop         | Webview-in-webview. Hard in Tauri. High.                                |
| Remote SSH workspaces                                    | cmux, Emdash, Claude Code Desktop | Config + PTY over SSH. High.                                            |
| Cloud / remote execution                                 | Claude Code Desktop               | Anthropic-hosted infrastructure; out of scope for an open MIT terminal. |

### Where gnar-term already has an edge

- **Extension model in inverse-dogfood form**: core no longer dogfoods git/gh/worktrees as
  extensions, but it does dogfood the extension API in the opposite direction — small extensions
  (`worktree-workspaces`, `github-sidebar`) wrap core primitives as control surfaces on the same
  API third parties use, demonstrating the "core owns the noun, extension owns the button" pattern
  end to end. Claude Code Desktop's plugin system is real but scoped to extending the chat
  agent, not the workspace UI itself.
- **Cross-platform Linux parity** — the only terminal-first option that runs natively on Linux
  alongside cmux's macOS workflow. Claude Code Desktop, Conductor, and cmux are all Linux-blocked
  for the client binary; SSH targeting doesn't change that.
- **Agent-agnostic by construction.** Any CLI agent that runs in a PTY runs in gnar-term, and
  the agentic-orchestrator's pattern list is user-extensible via `knownAgents`. Claude Code
  Desktop is Claude-only by design.
- **MCP-as-primary _server_ surface** with deterministic pane binding (cleaner than cmux's ad-hoc
  socket; orthogonal to Claude Code Desktop's MCP-as-client model).
- **Preview extension** rendering MD/PDF/CSV/images/video/JSON/YAML/TOML/logs — broader format
  coverage than Claude Code Desktop's HTML/PDF/image preview, and nobody else in the orchestrator
  set ships preview renderers of this breadth.
- **MIT license, no account, no subscription, self-hostable.** Stands alone among the group on
  all four counts — Claude Code Desktop in particular requires a paid Anthropic account.
- **cmux-config compatibility** — gnar-term is the only tool that lets a cmux user migrate
  without rewriting config.

---

## Positioning statement (suggested)

> gnar-term is a cross-platform, MIT-licensed terminal workspace manager for developers running
> AI coding agents. The core owns the nouns the workflow depends on: a great terminal, a command
> palette, 11 themes, an MCP _server_ surface with deterministic pane binding so agents can drive
> the UI from inside the terminal they're running in, worktree workspaces as a first-class
> concept (data model + lifecycle + archive/merge + a distinctive sidebar border), and a
> workspace status rail rendered directly by core (branch + ahead/behind + dirty + PR review +
> CI status). User-facing buttons that surface those nouns — and all genuinely additive features
> — ship as bundled extensions on the same API third-party authors use: `worktree-workspaces`
> exposes the New Worktree action, `github-sidebar` exposes the issues/PRs/commits tab,
> `diff-viewer` surfaces diffs, `preview` renders forty-plus file types, `file-browser`,
> `project-scope`, `jrvs-themes`, and the `agentic-orchestrator` itself. Disabling any extension
> hides its UI without taking the underlying capability with it. The `agentic-orchestrator`
> extension is the opt-in layer that wires those core primitives into orchestrator-first
> functionality — parallel agents in isolated worktrees, diff surfaces, Kanban dashboards,
> one-click PRs, issue-tracker ingestion — without leaving the terminal. If cmux is the
> macOS-native reference design for the terminal-first half, and Claude Code Desktop is the
> Mac+Windows vendor-chrome path for Claude-shaped workflows, gnar-term is the cross-platform
> MCP-native, agent-agnostic, MIT cousin whose core git/gh/worktree stack and extension model
> give it the plugin-extensible path into the orchestrator-first half.

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
- [Claude Code Desktop — official docs](https://code.claude.com/docs/en/desktop)
- [Anthropic Rebuilds Claude Code Desktop App Around Parallel Sessions (MacRumors, 2026-04-15)](https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/)
- [We tested Anthropic's redesigned Claude Code desktop app and 'Routines' (VentureBeat, 2026-04)](https://venturebeat.com/orchestration/we-tested-anthropics-redesigned-claude-code-desktop-app-and-routines-heres-what-enterprises-should-know)
- [Anthropic's redesigned Claude Code desktop app (The New Stack, 2026-04)](https://thenewstack.io/claude-code-desktop-redesign/)
- [Claude — Plans & Pricing](https://claude.com/pricing)
- [Conductors to Orchestrators (O'Reilly Radar)](https://www.oreilly.com/radar/conductors-to-orchestrators-the-future-of-agentic-coding/)
- [The future of agentic coding — Addy Osmani](https://addyosmani.com/blog/future-agentic-coding/)
