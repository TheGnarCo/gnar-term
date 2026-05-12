---
title: "Ontology"
parent: Architecture
nav_order: 6
---

# GnarTerm Ontology

> Canonical vocabulary for gnar-term. Agents and contributors should
> use these terms consistently. When in doubt, check here before
> naming a variable, type, store, table, issue, or PR.

The authoritative shapes behind these terms live in
[ADR-004 — Unified Workspace Shape](adr/004-unified-workspace-shape.md);
this file is the index, not the spec.

## Forbidden vocabulary

These terms are **not** part of gnar-term's domain language and must
not appear in code, types, comments, UI copy, or PR descriptions:

- **"Stage"** / "Stage 9" / "Stage 10" — internal migration labels.
  Describe shipped behavior, not the path that got us there.
- **"Project"** / "Project Scope" — superseded by **Workspace**.
- **"Group"** / "Workspace Group" — superseded by **Workspace**. The
  literal string `"group"` survives only as the stable id of the
  built-in **Overview Dashboard** contribution and is never
  user-facing.
- **"Parent" / "Child" workspace** — gnar-term has Roots and Branches.
  The back-reference is `rootWorkspaceId`, not `parentWorkspaceId`.
- **"Orchestrator"** / `parentOrchestratorId` / `AgentOrchestrator`
  — superseded by the **Agentic Dashboard** contribution riding on a
  Workspace.

When migrating older state or grepping historical commits these names
may surface; do not reintroduce them in new code.

## Terms

### Workspace

**Aliases:** none — "Workspace" is the canonical primitive.
**Do NOT use:** Project, Group, Container, Scope.
**Definition:** The single workspace primitive. A persisted record
that owns its own pane layout and may either be a **Root Workspace**
or a **Branch**, discriminated by the presence of `rootWorkspaceId`.
**Examples:** every entry in `state.workspaces[]`; everything in the
`workspaces` Svelte store at runtime.

---

### Root Workspace

**Aliases:** "root", "path-rooted Workspace".
**Do NOT use:** Project, Group, Parent Workspace.
**Definition:** A Workspace with no `rootWorkspaceId`. Path-rooted —
carries `path`, `color`, `isGit`, `createdAt`, `branchedWorkspaceIds`.
Renders as a **banner** in the sidebar Workspaces section.
**Examples:** the row created when the user opens a directory; the
target of "longest-prefix path match" auto-adoption.

---

### Branch

**Aliases:** "Branch Workspace" (when disambiguation is needed
between the noun and the git concept).
**Do NOT use:** Child Workspace, Sub-Workspace, Nested Workspace.
**Definition:** A Workspace with `rootWorkspaceId` set. Lives nested
inside its root's banner; never appears in `rootRowOrder`. A Branch's
root assignment is structurally permanent — a Branch never becomes a
Root and vice versa.
**Examples:** a worktree Branch spawned by the
`branched-workspaces` extension; the Overview Dashboard Branch
attached to a root.

---

### Worktree Branch

**Aliases:** "BranchedWorkspace" (the type-narrowing helper).
**Do NOT use:** "Worktree workspace" without the **Branch**
qualifier — the worktree is a Branch.
**Definition:** A Branch backed by a git worktree. Carries
`worktreePath`, `branch`, optional `baseBranch` and `repoPath`. The
`isBranchedWorkspace` type guard narrows to this shape.
**Examples:** rows produced by "Branch Workspace" tile actions; rows
produced by Agentic spawns with worktree provenance.

---

### Dashboard Branch

**Aliases:** "Dashboard" (when context is unambiguous).
**Do NOT use:** Dashboard Workspace as a separate type.
**Definition:** A Branch with `isDashboard: true` and a
`dashboardContributionId`. A constrained Branch hosting the
component-backed surface registered by a **Dashboard Contribution**.
The dashboard component is registered as a hidden surface type via
`registerDashboardWorkspaceType`; the dashboard Branch is seeded with
a single extension surface so PaneView's normal render path mounts the
component (preserving TabBar / split affordances).
**Examples:** the Overview Dashboard, the Agentic Dashboard, the
Diff Dashboard, the Claude Settings Dashboard.

---

### Pseudo-Workspace

**Aliases:** none.
**Do NOT use:** "Virtual workspace", "fake workspace".
**Definition:** A non-persisted pinned container registered by an
extension via `{ id, position, icon, render, settings? }`. Cannot be
deleted, renamed, or reordered through normal UI controls. Lives in
the pseudo-workspace registry, never in `state.workspaces[]`.
**Examples:** the Global Agentic Dashboard at `position: "root-top"`.

---

### Dashboard Contribution

**Aliases:** "dashboard kind" (informal).
**Do NOT use:** "Dashboard provider", "Dashboard plugin".
**Definition:** An extension-registered factory describing a kind of
Dashboard Branch:
`{ id, label, actionLabel, capPerGroup, create(workspace), isAvailableFor?(workspace) }`.
The registry drives "Add X Dashboard" menu items, their per-Workspace
caps, and restore-time deduplication keyed by
`${rootWorkspaceId}:${contributionId}`.
**Examples:** the built-in Overview contribution (`id: "group"`,
`capPerGroup: 1`); the Agentic, Diff, and Claude Settings
contributions registered by their respective extensions.

---

### Overview Dashboard

**Aliases:** none.
**Do NOT use:** "Group dashboard", "Workspace dashboard" (ambiguous
— every Dashboard belongs to a Workspace).
**Definition:** The built-in Dashboard Contribution provided by core
(`id: "group"`, `capPerGroup: 1`). Renders `WorkspaceOverviewBody`
directly — no markdown file. Composes Issues, PRs, and the workspaces
list with scope projected via `DashboardHostContext`. Linked from the
root via its `dashboardWorkspaceId`.

---

### Agentic Dashboard

**Aliases:** none.
**Do NOT use:** "Orchestrator", "Agent Orchestrator", "Workspace
Orchestrator".
**Definition:** A global surface registered by the `agentic`
extension and opened from a TitleBar button (mirrors the Settings /
Claude Settings pattern). The dashboard body
(`AgenticDashboardBody`) composes three live panels —
**Agent Board**, **Branch Lifecycle Swimlanes**, and
**Attention Inbox** — each subscribing to its respective core readable
(`api.agents`, `api.branchLifecycle`, `api.attention`). The dashboard
owns no parallel state.

---

### Global Agentic Dashboard

**Aliases:** none.
**Do NOT use:** "Agentic pseudo-workspace" (legacy — the dashboard is
no longer a pseudo-workspace).
**Definition:** The Agentic Dashboard surface itself, promoted to a
global surface (via `api.registerGlobalSurface("dashboard", ...)`) so
it opens like Settings and Claude Settings rather than living as a
pinned sidebar row. Summoned by the TitleBar Agentic button, whose
`isActive` store pulses when `api.attention` is non-empty.

---

### Agent Board

**Aliases:** none.
**Do NOT use:** "agent list", "agent kanban", "AgentList".
**Definition:** The Agentic Dashboard panel that lists every
currently-detected agent (live `api.agents`), grouped by owning
Workspace. Each card shows agent name, status pill, and a click
action that calls `api.focusSurface(surfaceId)`.

---

### Branch Lifecycle Swimlanes

**Aliases:** none.
**Do NOT use:** "lifecycle kanban", "branch board".
**Definition:** The Agentic Dashboard panel that renders
`BranchLifecycleEntry` values as kanban columns (draft / active /
awaiting_review / in_review / merged). Read-only — cards move
themselves as `api.branchLifecycle` updates. Surfaces a hint banner
when any entry has `prStateKnown: false` so the user knows `gh` data
is missing.

---

### Attention Inbox

**Aliases:** none.
**Do NOT use:** "notifications", "alerts", "events feed".
**Definition:** The Agentic Dashboard panel that renders
`api.attention` newest-first. Clicking a row calls
`api.focusSurface(surfaceId)` and then `api.dismissAttention(paneId)`.
Safe no-op when the target surface is no longer present.

---

### "+ New agentic branch" flow

**Aliases:** none.
**Do NOT use:** "spawn_branch UI" (the MCP tool is a peer, not the
UI's owner).
**Definition:** The Agentic Dashboard's primary header action. A
form prompt collects branch name, base branch, and AgentPreset; the
flow then materializes a worktree via
`api.invoke("create_worktree", ...)` and creates the Branch workspace
via `api.createWorkspaceFromDef(...)` with `rootWorkspaceId` set to
the active workspace's id, so the spawned worktree appears nested
under its triggering Workspace banner. The chosen AgentPreset's
command runs in the new workspace's terminal surface. Reaches the
same end state as the `spawn_branch` MCP tool without introducing a
new Tauri command.

---

### banner

**Aliases:** "workspace banner", "root row block".
**Do NOT use:** "card", "tile", "header" (sidebar headers are a
distinct UI element).
**Definition:** The sidebar block rendered for a `kind: "workspace"`
entry in `rootRowOrder`. Shows the root Workspace's name, color, git
status, and its nested Branch list.
**Examples:** every workspace row in the primary sidebar's
Workspaces section.

---

### root row

**Aliases:** none.
**Do NOT use:** "top-level workspace", "sidebar entry".
**Definition:** An entry in `rootRowOrder` — `{ kind, id }`. `kind`
is `"workspace"`, `"pseudo-workspace"`, or any extension-registered
kind. Renderers are looked up by kind via
`registerRootRowRenderer`. Branches are never root rows.
**Examples:** a workspace banner, a pinned Global Agentic Dashboard
row, an extension's pinned tool row.

---

### `paneLayout`

**Aliases:** none — this is the field name.
**Do NOT use:** `splitRoot` (legacy), `layout` without qualification
(ambiguous with the on-disk `LayoutNode`).
**Definition:** Each Workspace's pane tree (`SplitNode`). The root
Workspace's `paneLayout` is the working area when no Branch is
selected; each Branch carries its own.
**Examples:** `Workspace.paneLayout` in `src/lib/types.ts`.

---

### `rootRowOrder`

**Aliases:** none — this is the field name.
**Do NOT use:** `workspaceOrder`, `sidebarOrder`.
**Definition:** The persisted ordered list of root rows. Source of
truth for the Workspaces section's top-level order. Mutation goes
through helpers in `src/lib/stores/root-row-order.ts`. Branches do
not appear here.

---

### `extensionData`

**Aliases:** none.
**Do NOT use:** `metadata`, `extras`, `customData`.
**Definition:** Open-ended `Record<string, unknown>` on a Workspace
for extension-owned state. Keyed by extension id so contributions
don't collide. Replaces the prior `WorkspaceMetadata` blob.
**Examples:** an extension persisting its own per-Workspace
preferences without touching core fields.

---

### `spawnedBy`

**Aliases:** none.
**Do NOT use:** `creator`, `origin`, `parent`.
**Definition:** Provenance marker on a Branch indicating which
dashboard spawned it: `{ kind: "global" }` or
`{ kind: "workspace"; rootWorkspaceId }`. Drives the bot-icon
affordance in the sidebar and the "jump to active branch"
navigation. Companion field `spawnedFromIssues: number[]`
records GitHub issue numbers a worktree Branch was spawned to
handle.

---

## See also

- [ADR-004 — Unified Workspace Shape](adr/004-unified-workspace-shape.md)
- [ADR-001 — Extension Architecture](adr/001-extension-architecture.md)
- [ADR-002 — Extension API Evolution](adr/002-extension-api-evolution.md)
- Type definitions: `src/lib/types.ts`
- On-disk shape: `src/lib/config.ts` (`WorkspaceDef`, `AppState`)
- Sidebar order: `src/lib/stores/root-row-order.ts`
