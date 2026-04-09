# GnarTerm Competitive Analysis: Agentic Terminals & Orchestrators

Last updated: 2026-04-08

Comparison of GnarTerm against the leading agentic terminal and orchestration tools. Covers feature parity, architectural differences, and recommendations for closing gaps.

## The Landscape

The agentic terminal space has bifurcated into two camps:

- **Terminal replacements** (cmux, GnarTerm) that aim to be your daily-driver shell with agent awareness
- **Agent orchestrators** (Conductor, Emdash, Superset, Baton) that primarily manage AI coding sessions with terminal support as a secondary feature

GnarTerm is one of the few tools positioned to be both.

### Tool Profiles

| Tool          | Stack                       | Platform        | License                 | Price                | Primary Focus                    |
| ------------- | --------------------------- | --------------- | ----------------------- | -------------------- | -------------------------------- |
| **GnarTerm**  | Tauri v2, Svelte 5, Rust    | Mac, Win, Linux | Proprietary             | N/A                  | Terminal-first developer cockpit |
| **Emdash**    | Electron, React             | Mac, Linux      | Open source             | Free                 | Agent-agnostic ADE               |
| **Superset**  | Electron, React, Bun        | Mac, Win, Linux | ELv2 (source-available) | Free / $20/mo Pro    | Parallel agent workspaces        |
| **Conductor** | Native macOS                | Mac only        | Closed source           | Free (pay API costs) | Claude Code SDK wrapper          |
| **cmux**      | Native macOS (Swift/AppKit) | Mac only        | GPL-3.0                 | Free / $199 founder  | Agent-aware terminal             |
| **dmux**      | Node.js on tmux             | Mac, Linux      | MIT                     | Free                 | Worktree multiplexer CLI         |
| **Baton**     | Desktop app (unknown stack) | Mac, Win, Linux | Closed source           | Free / $49 one-time  | Worktree-backed agent manager    |

### Funding & Traction

| Tool          | Backing                                       | Notable Customers            |
| ------------- | --------------------------------------------- | ---------------------------- |
| **Emdash**    | YC W26 (General Action, team of 2)            | Early stage                  |
| **Superset**  | Founded by 3 ex-YC CTOs                       | Amazon, Google, ServiceNow   |
| **Conductor** | YC S24, $22M Series A (Melty Labs, team of 4) | Linear, Vercel, Notion, Ramp |
| **cmux**      | Manaflow AI, 13.2k GitHub stars               | Broad open-source adoption   |
| **dmux**      | Standard Agents (FormKit), 1.3k GitHub stars  | Developer community          |
| **Baton**     | Solo founder (Tord Roar Tafjord)              | Early stage                  |

---

## Feature Comparison

### 1. Agent Orchestration

| Feature                    | GnarTerm                                   | Emdash              | Superset            | Conductor                 | cmux                     | dmux                  | Baton                        |
| -------------------------- | ------------------------------------------ | ------------------- | ------------------- | ------------------------- | ------------------------ | --------------------- | ---------------------------- |
| Multi-agent CLI support    | Configurable presets                       | 23 agents           | 9+ agents           | 2 (Claude + Codex)        | Any CLI                  | 11 agents             | Any CLI                      |
| Parallel agent execution   | Yes (multiple harness surfaces)            | Yes                 | 10+ simultaneous    | Yes                       | Yes                      | Yes (3-4 recommended) | Yes (4 free, unlimited paid) |
| Best-of-N comparison       | No                                         | Yes                 | No                  | Yes (multi-model)         | No                       | No                    | No                           |
| Agent status detection     | Yes (3-layer: OSC 9, title parse, process) | Yes                 | Yes (notifications) | Yes (SDK-level)           | Yes (notification rings) | Yes (native alerts)   | Yes (status badges)          |
| Agent dashboard / overview | No                                         | Yes (kanban)        | Yes (dashboard)     | Yes (backlog/review/done) | No                       | No                    | Yes (grouped cards)          |
| Auto-approve mode          | No                                         | Yes (9 agents)      | No                  | Yes                       | No                       | No                    | No                           |
| Resume sessions            | No                                         | Yes (6 agents)      | Yes (daemon)        | No                        | Layout only              | tmux detach           | No                           |
| MCP server integration     | No                                         | No                  | Yes                 | Yes (.mcp.json)           | No                       | No                    | Yes (agent-spawns-agent)     |
| Skills / capability system | No                                         | Yes (open standard) | No                  | CLAUDE.md / Agents.md     | No                       | No                    | Templates                    |
| Smart workspace creation   | No                                         | No                  | No                  | Yes (city names)          | No                       | Yes (AI branch names) | Yes (AI title + branch)      |

**Key insight**: GnarTerm already supports multiple harness surfaces per workspace (each with its own PTY and status tracker), but the UI doesn't expose this well. The `+` button only creates terminals. Competitors make parallel agent spawning a first-class interaction.

### 2. Git & Worktree Management

| Feature                       | GnarTerm                     | Emdash                   | Superset          | Conductor                       | cmux | dmux                    | Baton           |
| ----------------------------- | ---------------------------- | ------------------------ | ----------------- | ------------------------------- | ---- | ----------------------- | --------------- |
| Auto worktree per task        | Yes                          | Yes                      | Yes               | Yes                             | No   | Yes                     | Yes             |
| Worktree placement strategies | 3 (nested, siblings, custom) | Siblings only            | Siblings only     | Standard                        | N/A  | Configurable prefix     | Standard        |
| .env / gitignored file copy   | No                           | Yes (configurable globs) | Via setup scripts | Via setup scripts               | N/A  | No                      | No              |
| Setup/teardown scripts        | No                           | No                       | Yes (config.json) | Yes (per-workspace)             | No   | Yes (6 lifecycle hooks) | No              |
| Built-in merge workflow       | No                           | No                       | Standard git      | Yes (PR + auto-merge)           | N/A  | Yes (one-step merge)    | Standard git    |
| PR creation from app          | No                           | Yes                      | Yes               | Yes (editable templates)        | No   | No                      | Yes (one-click) |
| CI/CD status viewing          | No                           | Mentioned                | Yes (indicators)  | Yes (view logs, re-run)         | No   | No                      | No              |
| Branch management UI          | Yes                          | No                       | No                | Yes                             | No   | Yes                     | Yes             |
| Worktree lifecycle states     | Active / Stashed / Archived  | Active only              | Active only       | Backlog/In Progress/Review/Done | N/A  | Active + cleanup        | Active only     |

**Key insight**: GnarTerm's 3-option worktree placement and lifecycle states (active/stashed/archived) are more sophisticated than competitors. The gaps are in workflow automation: setup scripts, .env copying, and PR creation are what make worktree isolation practical day-to-day.

### 3. Code Review & Diff

| Feature                     | GnarTerm          | Emdash       | Superset                   | Conductor                       | cmux | dmux                 | Baton                   |
| --------------------------- | ----------------- | ------------ | -------------------------- | ------------------------------- | ---- | -------------------- | ----------------------- |
| Built-in diff viewer        | Yes (DiffSurface) | Yes          | Yes (side-by-side, inline) | Yes (Pierre Diffs, incremental) | No   | Yes (inline preview) | Yes (Monaco-powered)    |
| File staging from diff      | No                | Yes          | No                         | No                              | No   | No                   | Yes (per-file rollback) |
| Checkpoints / revert        | No                | No           | No                         | Yes (per-turn revert)           | No   | No                   | No                      |
| Built-in code editor        | No                | Yes (Monaco) | Yes (CodeMirror)           | Yes (manual mode)               | No   | No                   | No                      |
| Diff comments               | No                | No           | No                         | Yes (multi-line, markdown)      | No   | No                   | No                      |
| Historical diff per message | No                | No           | No                         | Yes                             | No   | No                   | No                      |

**Key insight**: Conductor's checkpoint system (view what changed at each conversation turn, revert to any point) is genuinely novel and requires deep SDK integration that other tools can't easily replicate. For GnarTerm, the more practical wins are staging from the diff view and PR creation.

### 4. Terminal & UI

| Feature                     | GnarTerm                                                         | Emdash         | Superset                                | Conductor                                    | cmux                      | dmux                   | Baton                                  |
| --------------------------- | ---------------------------------------------------------------- | -------------- | --------------------------------------- | -------------------------------------------- | ------------------------- | ---------------------- | -------------------------------------- |
| Full terminal emulator      | Yes (xterm.js + WebGL)                                           | Yes (xterm.js) | Yes                                     | Per-workspace only                           | Yes (libghostty, GPU)     | Inherits host terminal | Yes                                    |
| Split panes                 | Yes (binary tree)                                                | No             | Yes                                     | No                                           | Yes                       | Yes (tmux)             | Yes                                    |
| Theme system                | 10 built-in themes                                               | No             | No                                      | Dark/Light                                   | Ghostty config compat     | Inherits host          | No                                     |
| Command palette             | Yes (Cmd+P)                                                      | No             | No                                      | Yes (Cmd+K)                                  | No                        | No                     | No                                     |
| File preview system         | Yes (10+ formats: PDF, CSV, images, video, markdown, YAML, TOML) | No             | No                                      | Images only                                  | No                        | No                     | No                                     |
| Find in terminal            | Yes (SearchAddon)                                                | No             | No                                      | Yes (Cmd+F)                                  | No                        | No                     | Yes                                    |
| Backpressure / flow control | Yes (condvar, high/low water marks)                              | No             | No                                      | No                                           | No                        | No                     | No                                     |
| Shell integration (CWD)     | Yes (OSC 7, zsh/bash)                                            | No             | No                                      | No                                           | No                        | No                     | No                                     |
| Context menus               | Yes (pane, file path, workspace)                                 | No             | No                                      | No                                           | No                        | No                     | No                                     |
| Session persistence         | Layout + metadata                                                | No             | Yes (daemon, survives close)            | No                                           | Layout only               | tmux detach/reattach   | No                                     |
| Built-in browser            | No                                                               | No             | Yes (preview)                           | No                                           | Yes (scriptable, cookies) | No                     | No                                     |
| Remote/SSH workspaces       | No                                                               | Yes            | No                                      | No                                           | Yes (full SSH support)    | No                     | No                                     |
| Mobile monitoring           | No                                                               | No             | Yes (web app)                           | No                                           | No                        | No                     | No                                     |
| IDE handoff                 | No                                                               | No             | Yes (VS Code, Cursor, Xcode, JetBrains) | Yes (VS Code, Cursor, Zed, Xcode, JetBrains) | No                        | No                     | Yes (VS Code, Cursor, Windsurf, Xcode) |

**Key insight**: GnarTerm is the strongest pure terminal emulator in this group. The file preview system (10+ formats with live reload), backpressure flow control, shell integration, and theme system are unmatched. cmux is the only competitor that also tries to be a real terminal (via libghostty), but it lacks worktree management and merge workflows.

### 5. Integrations

| Feature               | GnarTerm         | Emdash | Superset               | Conductor                              | cmux                       | dmux          | Baton                  |
| --------------------- | ---------------- | ------ | ---------------------- | -------------------------------------- | -------------------------- | ------------- | ---------------------- |
| GitHub Issues         | Yes (via gh CLI) | Yes    | No                     | Yes (deep sync)                        | No                         | No            | No                     |
| GitHub PRs            | Yes (via gh CLI) | Yes    | No                     | Yes (comments, status checks, merge)   | No                         | No            | Yes (one-click create) |
| Linear                | No               | Yes    | No                     | Yes (deeplinks)                        | No                         | No            | No                     |
| Jira                  | No               | Yes    | No                     | No                                     | No                         | No            | No                     |
| Slack                 | No               | No     | No                     | Yes (deeplinks)                        | No                         | No            | No                     |
| MCP servers           | No               | No     | Yes                    | Yes (.mcp.json inherited by worktrees) | No                         | No            | Yes                    |
| CLI / Unix socket API | No               | No     | No                     | No                                     | Yes                        | No            | No                     |
| Lifecycle hooks       | No               | No     | Setup/teardown scripts | Setup scripts                          | Hooks dir (~/.cmux/hooks/) | Yes (6 hooks) | No                     |

### 6. Configuration & Project Management

| Feature              | GnarTerm                                | Emdash                     | Superset                    | Conductor                    | cmux                     | dmux                     | Baton           |
| -------------------- | --------------------------------------- | -------------------------- | --------------------------- | ---------------------------- | ------------------------ | ------------------------ | --------------- |
| Per-project config   | Yes (gnar-term.json)                    | Yes (project config modal) | Yes (.superset/config.json) | Yes (conductor.json)         | Yes (cmux.json)          | Yes (~/.config/dmux/)    | No              |
| Harness preset merge | Yes (global + per-project, merge by ID) | No (agent-level config)    | No                          | No (uses agent's own config) | No                       | Yes (per-agent settings) | Yes (templates) |
| Project color coding | Yes (12-color palette)                  | No                         | No                          | No                           | No                       | No                       | No              |
| Project registration | Yes (add/clone/archive)                 | Yes (add project)          | Yes (add project)           | Yes (add repo)               | No                       | Yes (multi-project)      | Yes (add repo)  |
| Custom commands      | Yes (settings.json commands[])          | No                         | Yes (terminal presets)      | Yes (slash commands)         | Yes (cmux.json commands) | No                       | No              |

---

## GnarTerm's Unique Strengths

These are capabilities where GnarTerm is ahead of or differentiated from all competitors:

1. **Full terminal emulator with agent awareness** — Most competitors are agent wrappers that happen to include a terminal. GnarTerm is a terminal that happens to orchestrate agents. This matters for daily-driver adoption.

2. **File preview system** — 10+ format previewer (PDF, CSV, images, video, markdown, YAML, TOML, JSON) with live reload. No competitor offers anything comparable.

3. **Cross-platform via Tauri v2** — Conductor and cmux are macOS-only. Emdash and Superset use Electron (heavier memory/CPU). Tauri gives native performance on all platforms.

4. **Worktree placement strategies** — 3 configurable options (nested `.worktrees/`, siblings, custom base directory) vs. competitors' single fixed approach.

5. **Worktree lifecycle states** — Active/Stashed/Archived lifecycle with branch push prompts on archive. Most competitors only have "active" and "deleted."

6. **Terminal engineering** — Backpressure flow control with condvar-based blocking and high/low water marks (128KB/32KB), WebGL-accelerated rendering, shell integration (OSC 7 CWD tracking). These are terminal-nerd features that agent-wrapper tools don't attempt.

7. **Theme system** — 10 built-in themes (6 dark, 4 light) with instant preview. Only cmux (via Ghostty config compat) comes close.

8. **Surface-based architecture** — Clean discriminated union of surface types in panes. New capabilities slot in as new surface kinds without architectural changes. This is more flexible than competitors' fixed layouts.

9. **Per-project harness preset merging** — Global harness presets with per-project overrides that merge by ID. Enables project-specific agent configurations without duplicating the global config.

10. **Project color coding** — 12-color palette for visual identification of projects. Small but appreciated UX detail no competitor offers.

---

## Critical Gaps

### Tier 1 — Table Stakes

Every major competitor has these. Missing them makes GnarTerm feel incomplete.

#### Gap 1: Surface Type Discoverability

**Problem**: GnarTerm supports multiple harness surfaces per workspace, but the TabBar `+` button only creates terminals. Users can't discover or use parallel agents without knowing the internals.

**Recommendation**: Change the `+` button to a dropdown menu listing all available surface types (Terminal, each harness preset, Preview). Add a "switch surface" button to the pane chrome (near split/close controls).

**Architecture**: UI-only change. `TabBar.svelte` + `PaneView.svelte` + `App.svelte`. No new types or Rust changes.

**Competitors with this**: All (Emdash has agent picker, Superset has workspace creation, Conductor has workspace creation, dmux has `n` key, Baton has "New Workspace" with agent selection).

#### Gap 2: In-App PR Creation

**Problem**: Worktree workspaces produce changes but there's no way to stage, commit, and create a PR without switching to the terminal.

**Recommendation**: Phase 1: Add action buttons to the existing `DiffSurface` (stage, commit, push, create PR). Phase 2: Full `PrSurface` kind with multi-step workflow.

**Architecture**: Phase 1 enhances existing `DiffView.svelte` + 3 new Rust commands (`git_add`, `git_commit`, `gh_create_pr`). Phase 2 adds new surface kind.

**Competitors with this**: Emdash, Superset, Conductor, Baton.

#### Gap 3: Agent Dashboard

**Problem**: No way to see all running agents across workspaces at a glance. Users must click through each workspace to check agent status.

**Recommendation**: Add an "Agents" section to the existing project dashboard view. Shows all running agents for that project with status indicators and quick-jump actions. No new view or surface type — dashboards are views, not panes.

**Architecture**: New section in `ProjectDashboard.svelte` + derived store aggregating harness surfaces from project workspaces. Fits naturally alongside existing Issues/PRs sections.

**Competitors with this**: Emdash (kanban), Superset (dashboard), Conductor (sidebar statuses + workspace board), Baton (grouped cards).

### Tier 2 — Competitive Differentiators

These separate the good tools from the great ones.

#### Gap 4: Setup Scripts & Lifecycle Hooks

**Problem**: Creating a new worktree workspace leaves it in a broken state — no `.env`, no `node_modules`, no Docker overrides. Users must manually fix up every workspace.

**Recommendation**: Add `lifecycle` hooks and `copyFiles` to the per-project `gnar-term.json` config. Run scripts automatically on workspace create/merge/archive. Show progress in an app-wide footer bar.

**Architecture**: Config schema change in `settings.ts` + hook execution in `workspace-actions.ts` + new `run_script` Rust command + footer component.

**Competitors with this**: Emdash (gitignored file auto-copy), Superset (setup/teardown scripts), Conductor (setup scripts), dmux (6 lifecycle hooks).

#### Gap 5: IDE Handoff

**Problem**: No way to open a worktree in VS Code, Cursor, or another editor from within GnarTerm.

**Recommendation**: Add "Open in Editor" to workspace context menus and command palette. New `preferredEditor` setting. Trivial Rust command: `open_in_editor(path, command)`.

**Architecture**: Settings change + one Rust command + context menu items.

**Competitors with this**: Superset, Conductor, Baton.

#### Gap 6: Sidebar Multi-Agent Status

**Problem**: The sidebar shows status for only the first harness in each workspace. With multiple agents, this is misleading.

**Recommendation**: Aggregate all harness statuses per workspace. Show count badges: "2 running, 1 waiting".

**Architecture**: Change `getHarnessStatus()` in `Sidebar.svelte` to return aggregated status.

**Competitors with this**: Conductor (per-workspace status), Baton (status badges on cards).

#### Gap 7: Auto-Spawn Multiple Harnesses

**Problem**: When creating a managed workspace, only the `defaultHarness` is launched. No way to auto-spawn multiple agents.

**Recommendation**: New `autoSpawnHarnesses: string[]` in `ProjectSettingsOverride`. On workspace create, spawn each listed preset into its own pane.

**Architecture**: Config schema + workspace-actions.ts enhancement.

**Competitors with this**: Baton (templates), dmux (multi-agent launch).

### Tier 3 — Emerging Differentiators

1-2 competitors have these. Worth designing for but not urgent.

#### Gap 8: MCP Server Integration

Let agents spawn new workspaces/agents programmatically. Baton's "agent-spawns-agent" pattern via MCP is powerful for autonomous workflows.

**Architecture**: New MCP server endpoint exposing workspace creation + harness spawning APIs.

#### Gap 9: Best-of-N Comparison

Run the same prompt across multiple agent CLIs and compare outputs. Emdash's signature feature.

**Architecture**: Specialized workspace creation flow that forks N worktrees from the same commit, spawns different agents, and provides a comparison view.

#### Gap 10: Checkpoints / Per-Turn Revert

View what changed at each conversation turn and revert to any point. Conductor's unique feature, requires Claude Code SDK integration.

**Architecture**: Would require intercepting agent tool calls or snapshotting git state at conversation boundaries. Deep integration work.

#### Gap 11: Issue Tracker Integration

Pull Linear/Jira/GitHub issues into agent context. Emdash and Conductor both offer this.

**Architecture**: New integration layer. Could start with enhancing existing GitHub issue fetching in ProjectDashboard to include "Send to Agent" action.

#### Gap 12: Remote/SSH Workspaces

Run agents on remote machines. Emdash and cmux support this.

**Architecture**: Significant Rust backend work for SSH PTY tunneling.

#### Gap 13: Built-in Browser

Embedded webview for previewing localhost apps. cmux has a full scriptable browser; Superset has preview.

**Architecture**: New `BrowserSurface` kind using Tauri v2 embedded webview API.

#### Gap 14: Built-in Code Editor

Quick file edits without leaving GnarTerm. Emdash (Monaco), Superset (CodeMirror), Conductor all have this.

**Architecture**: New `EditorSurface` kind using CodeMirror 6. May be lower priority if IDE handoff (Gap 5) is implemented.

---

## Recommendations Mapped to GnarTerm Architecture

Each gap maps to a specific architectural concept:

| Gap                        | Architecture Concept                    | Change Type               | Effort     |
| -------------------------- | --------------------------------------- | ------------------------- | ---------- |
| 1. Surface discoverability | TabBar + pane chrome                    | UI only                   | Low        |
| 2. PR creation             | DiffSurface enhancement → new PrSurface | Surface + Rust            | Medium     |
| 3. Agent dashboard         | Section in ProjectDashboard             | Component + derived store | Low-Medium |
| 4. Setup scripts           | Settings schema + workspace-actions     | Config + Rust             | Medium     |
| 5. IDE handoff             | Settings + Rust command                 | Config + Rust             | Low        |
| 6. Sidebar multi-status    | Sidebar component                       | UI only                   | Low        |
| 7. Auto-spawn harnesses    | Settings schema + workspace-actions     | Config                    | Low        |
| 8. MCP integration         | New MCP server module                   | Backend                   | High       |
| 9. Best-of-N               | Workspace creation flow + comparison UI | Surface + flow            | High       |
| 10. Checkpoints            | Agent SDK integration                   | Deep integration          | Very high  |
| 11. Issue tracker          | ProjectDashboard enhancement            | UI + integration          | Medium     |
| 12. Remote/SSH             | Rust SSH tunneling                      | Backend                   | Very high  |
| 13. Browser                | New BrowserSurface                      | Surface                   | Medium     |
| 14. Editor                 | New EditorSurface                       | Surface                   | Medium     |

### Surface Type Roadmap

Current surface types and planned additions:

```
EXISTING                          PLANNED
─────────────────────────────     ─────────────────────────────
terminal     (PTY shell)          pr           (stage/commit/PR flow)
harness      (AI agent PTY)      browser      (embedded webview)
preview      (file viewer)       editor       (CodeMirror text editor)
diff         (git diff)
filebrowser  (file listing)
commithistory (commit log)
harness-placeholder (relaunch)
```

### View Roadmap

Views are full-screen modes — NOT panes or surfaces. Dashboards live here.

```
EXISTING                          PLANNED ENHANCEMENTS
─────────────────────────────     ─────────────────────────────
home         (project cards)      (no changes)
workspace    (pane/surface area)  (no changes)
project      (project detail)     + Agents section (running agent overview)
settings     (user preferences)   + preferredEditor, lifecycle hooks config
```

---

## Competitive Positioning Summary

**Where GnarTerm wins today**: Terminal quality, file preview, cross-platform, worktree sophistication, theme/UX polish.

**Where GnarTerm must catch up**: Surface discoverability (the multi-agent capability exists but is hidden), PR workflow, agent dashboard, setup automation.

**Where GnarTerm can leapfrog**: By being the only tool that is both a great terminal AND a great orchestrator. cmux is the best terminal but has no worktree/merge tooling. Conductor has the best orchestration but isn't a terminal anyone would use daily. GnarTerm can own both sides.

**Strategic moat**: The surface-based architecture means new capabilities are additive — each surface kind is an isolated feature, not an architectural risk. Competitors with fixed layouts (Conductor, Baton) have to rebuild UI to add new content types. GnarTerm just adds a new `kind` to the discriminated union.
