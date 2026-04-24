# Competitive Analysis — gnar-term (2026-04-20)

_Branch: `jrvs/oc-orchestrator`. Reference seed: [competitive-landscape.md](competitive-landscape.md).
Competitor facts live in the seed and are cited, not restated._

## Where gnar-term sits in the taxonomy

Hybrid **terminal-first + orchestrator-first**. Core is a cross-platform Tauri
terminal (macOS / Linux / Windows) with a first-class extension API, MCP _server_
endpoint, and passive agent detection in the core. Orchestrator features ship as
extensions (`agentic-orchestrator`, `worktree-workspaces`, `diff-viewer`,
`github-sidebar`).

Closest shape peer: **cmux** (terminal-first, OSC notifications, CLI control
plane). Biggest divergence from orchestrator-first peers (Conductor, Emdash,
Baton, Superset): we treat worktrees/diffs/PRs as extensions over a terminal,
not as the product.

---

## Common / table-stakes features we are missing

Ordered by how universally competitors ship them. Each row cites the seed.

| Gap                                  | Who ships it                                                            | gnar-term state                                                                                                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git worktree-per-agent automation    | Conductor, Emdash, Baton, Superset, CCD                                 | `worktree-workspaces` extension exists but is a thin wrapper over a core `worktrees:create-workspace` command. No dashboard-level "spawn N" primitive.              |
| Diff viewer with inline PR comments  | Baton (Monaco), CCD, Superset                                           | `diff-viewer` extension renders unified diffs. No inline comments, no split view, no per-file rollback.                                                             |
| One-click PR open                    | Baton, CCD                                                              | None. Users shell out to `gh` manually.                                                                                                                             |
| Auto-fix failing CI / auto-merge     | CCD                                                                     | None. Status registry exposes CI state; no action automation.                                                                                                       |
| Live-preview pane / headless browser | CCD, cmux (scriptable browser)                                          | Filed as [#74](https://github.com/TheGnarCo/gnar-term/issues/74) (pane) + [#69](https://github.com/TheGnarCo/gnar-term/issues/69) (scriptable).                     |
| Issue-tracker ingestion              | Emdash (Linear/Jira/GH/GitLab), CCD (Connectors), Baton (autonomous GH) | `github-sidebar` covers GH issues/PRs. No Linear, Jira, or GitLab.                                                                                                  |
| Remote SSH workspaces                | cmux, Emdash, CCD                                                       | Open issue [#70](https://github.com/TheGnarCo/gnar-term/issues/70).                                                                                                 |
| Scriptable / embedded browser        | cmux                                                                    | Open issue [#69](https://github.com/TheGnarCo/gnar-term/issues/69).                                                                                                 |
| "Open in VS Code / Cursor / Xcode"   | Baton, Superset                                                         | None.                                                                                                                                                               |
| Side chats (context-branch)          | CCD                                                                     | None.                                                                                                                                                               |
| Extensions / skills marketplace      | CCD                                                                     | Open issue [#43](https://github.com/TheGnarCo/gnar-term/issues/43) (Extension infra). Marketplace filed as [#73](https://github.com/TheGnarCo/gnar-term/issues/73). |
| Saved dashboard recipes              | All orchestrators ship preset templates                                 | Open issue [#19](https://github.com/TheGnarCo/gnar-term/issues/19).                                                                                                 |
| Pane divider drag-resize             | Universal                                                               | Open issue [#1](https://github.com/TheGnarCo/gnar-term/issues/1). Still 50/50 splits.                                                                               |
| ⌘F find-in-terminal                  | cmux, any serious terminal                                              | Not implemented ([CMUX-GAP-ANALYSIS.md#7](../CMUX-GAP-ANALYSIS.md)).                                                                                                |
| ⌘K clear scrollback                  | Universal                                                               | Open issue [#3](https://github.com/TheGnarCo/gnar-term/issues/3).                                                                                                   |
| ⌘+/−/0 font zoom                     | Universal                                                               | Open issue [#4](https://github.com/TheGnarCo/gnar-term/issues/4).                                                                                                   |
| bash / fish shell integration        | cmux (via Ghostty), CCD                                                 | Open issue [#5](https://github.com/TheGnarCo/gnar-term/issues/5). Only zsh today.                                                                                   |

---

## Special features we could cheaply adopt

Ranked by effort-to-payoff. "Cheap" = plugs into an existing primitive.

1. **One-click PR open** — we already shell `gh` in `github-sidebar`; add
   `gh pr create --fill` action + status-registry toast. ~1 day.
2. **"Open in $EDITOR" context-menu action** — new context-menu contributions
   keyed off workspace cwd. Editor picker already exists in Rust
   (`src-tauri/src/lib.rs`). ~1 day.
3. **cmux-style project actions file** — our `gnar-term.json` is
   cmux-compatible; a `commands:` block loadable into the palette mirrors
   cmux's `cmux.json` actions with trivial reuse of the command registry. ~2 days.
4. **Notification _rings_ on panes** (cmux) — we already parse OSC 9/99/777 and
   flip unread badges. Add a pulse border style on `TerminalPane.svelte` bound
   to the agent status store. ~0.5 day.
5. **CI status bar after PR open** (CCD) — our status registry already carries
   PR + CI metadata per workspace. Render a workspace footer row that polls
   `gh pr checks`. ~2 days.
6. **Linear / Jira sidebar tabs** — the secondary-sidebar-tab API already
   supports external data sources (`github-sidebar` is the reference). Ship
   each as a separate extension that posts into the same status registry.
   ~3 days per tracker.
7. **Split / unified diff toggle in `diff-viewer`** — diff rendering is already
   extension-owned. Swap in a Monaco diff view for a split option; keep the
   current renderer as the unified fallback. ~2 days.

---

## What we should sharpen (differentiation to preserve)

These are table-stakes _nowhere else_ and should get first-class treatment.

### Interactive markdown widgets

`registerMarkdownComponent` (kanban, agent-list, columns) lets dashboards be
_editable UIs_ that persist as markdown files. No competitor treats the
dashboard as a file. This is the seed for saved-recipes (#19) and for
publishable dashboard templates.

### MCP _server_ endpoint

We expose 19 tools over UDS/JSON-RPC with per-connection pane/workspace
binding. Only Superset advertises MCP-server behavior; their surface is
thinner. This is a credible moat for agent ecosystems.

### Cross-platform

macOS + Linux + Windows, shipped. Only Emdash and Baton ship Linux; only CCD
ships Windows. None ship all three on day one. Keep this invariant — don't
regress to mac-only code paths.

### Deep extension API

~15 event types, 29-command allowlist, denied-by-default permissions, path
restrictions, workspace/pane/surface/sidebar/command/contextMenu registries.
Closest peer is CCD's Extension system; CCD Extensions are account-gated and
single-vendor. Our API is open + local-first.

---

## Roadmap tie-in

Mapping gaps above to live issues. Anything unmatched is a candidate new issue.

| Gap                              | Existing issue                                                                                                   | Action                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Remote SSH                       | [#70](https://github.com/TheGnarCo/gnar-term/issues/70)                                                          | Keep on backlog. Largest scope gap vs. cmux/Emdash/CCD.                                       |
| Scriptable browser               | [#69](https://github.com/TheGnarCo/gnar-term/issues/69)                                                          | Keep. Pairs well with live-preview pane.                                                      |
| PTY daemon + session persistence | [#68](https://github.com/TheGnarCo/gnar-term/issues/68)                                                          | Prerequisite for real session restore parity with cmux.                                       |
| Extension infrastructure         | [#43](https://github.com/TheGnarCo/gnar-term/issues/43), [#41](https://github.com/TheGnarCo/gnar-term/issues/41) | Dedupe. Prerequisite for marketplace [#73](https://github.com/TheGnarCo/gnar-term/issues/73). |
| Extension marketplace            | [#73](https://github.com/TheGnarCo/gnar-term/issues/73)                                                          | Long-tail. Filed; not scheduled.                                                              |
| Live-preview pane                | [#74](https://github.com/TheGnarCo/gnar-term/issues/74)                                                          | Roadmap. Filed; not scheduled. Pairs with #69.                                                |
| MCP right-sidebar polish         | [#42](https://github.com/TheGnarCo/gnar-term/issues/42)                                                          | Ties into Linear/Jira extensions.                                                             |
| Dashboard recipes                | [#19](https://github.com/TheGnarCo/gnar-term/issues/19)                                                          | Stronger now with markdown-widget story.                                                      |
| Theme control over expanded UI   | [#71](https://github.com/TheGnarCo/gnar-term/issues/71)                                                          | Keep — expanded theming unlocks richer dashboard visuals.                                     |
| Shell integration (bash/fish)    | [#5](https://github.com/TheGnarCo/gnar-term/issues/5)                                                            | Bash first — largest user base.                                                               |
| Font zoom                        | [#4](https://github.com/TheGnarCo/gnar-term/issues/4)                                                            | Trivial.                                                                                      |
| Clear scrollback                 | [#3](https://github.com/TheGnarCo/gnar-term/issues/3)                                                            | Trivial.                                                                                      |
| Pane resize                      | [#1](https://github.com/TheGnarCo/gnar-term/issues/1)                                                            | Trivial. Every competitor has this.                                                           |
| **⌘F find-in-terminal**          | _none_                                                                                                           | New issue. xterm.js SearchAddon. Trivial.                                                     |
| **One-click PR open**            | _none_                                                                                                           | New issue. `gh pr create --fill` wrapper.                                                     |
| **Linear / Jira sidebar**        | _none_                                                                                                           | New issue(s) per tracker.                                                                     |
| **Inline diff comments**         | _none_                                                                                                           | New issue. Stretch for `diff-viewer`.                                                         |
| **CI status bar / auto-fix**     | _none_                                                                                                           | New issue. Layered on status registry.                                                        |

Suggested near-term sequencing:

1. **Trivial quick wins** — #1, #3, #4, #5 and new ⌘F/PR-open. Close the terminal-polish gap.
2. **Extension infra consolidation** — #41/#43 dedupe, then dashboard recipes (#19).
3. **Remote surface** — #68 daemon, then #70 SSH, then #69 browser. This is
   the Conductor/Emdash/cmux parity track; it's the most expensive block.

---

## Alternative names

Two buckets: **Gnar X** (keeps the company marque front-of-brand, like
`gnar-term` itself) and **I-names** (follows the `Immerse` pattern already used
by Gnar Immerse). Unordered within each bucket; brief vibe-check only, not a
full trademark audit.

### Gnar X

1. **GnarRig** — terminal as scaffolding/rigging for agent fleets.
2. **GnarYard** — switchyard: panes as tracks, agents as trains you route.
3. **GnarLoom** — weaving parallel agent output into one surface.
4. **GnarNest** — workspaces-as-a-tree; ties into the dashboard-as-file model.
5. **GnarGantry** — overhead track running parallel agents.
6. **GnarHarness** — harness for agents; the terminal holds the reins.
7. **GnarRookery** — colony of nested workspaces; keeps the bird/cliff motif
   adjacent to "gnar".
8. **GnarPatch** — patchwork dashboards stitched from markdown widgets.

### I-names (Immerse-style)

1. **Inscribe** — ties to the markdown-dashboard-as-file model.
2. **Invoke** — terminal as the call-site for agent dispatch.
3. **Interlace** — weaving parallel agent output across panes.
4. **Inlet** — entry point to an agent fleet; small-word, sharp.
5. **Iterate** — the loop is the product; agents iterate inside panes.
6. **Instrument** — instrumented terminal; agents as measured tools.

---

## Changelog

| Date       | Change                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-20 | Initial on-demand analysis for branch `jrvs/oc-orchestrator`. Cites `competitive-landscape.md` last-verified 2026-04-20.                                            |
| 2026-04-20 | Drop nested-workspaces differentiator + in-flight references (dashboard icon click, tasks propagation, gh-issues widget); rename list switched to Gnar-X / I-names. |
