# ADR 004 — Unify Projects and Agentic Orchestrators into Workspace Groups

Status: Accepted
Date: 2026-04-20
Supersedes: implicit contract in ADR-002 that Projects and Orchestrators are parallel extension-owned containers

## Context

gnar-term accumulated two independent "nested container" concepts:

- **Projects** (`src/extensions/project-scope/`) — grouping primitive; a project has a root `path`, owns a Dashboard workspace, and claims workspaces whose metadata carries `projectId`.
- **Agentic Orchestrators** (`src/extensions/agentic-orchestrator/`) — agent-scoped container; an orchestrator has a `baseDir`, owns a Dashboard workspace with `gnar:kanban` + `gnar:agent-list` + task-spawner, and can optionally nest under a project via `parentProjectId`.

The two concepts have duplicate machinery (eagerly-owned dashboard workspace; root-row renderer; claim-by-metadata; nested workspace tracking) with nearly identical lifecycle semantics. A user creating "an agentic space inside a project" must reason about two parallel entity types and their intersection. Root-level orchestrators compete with root-level projects for sidebar space. Widget props (`orchestratorId`) pin behavior to one entity type rather than riding on a uniform dashboard surface.

## Decision

Collapse the two concepts into one primitive — **Workspace Group** — living in core, with a generic contribution model for dashboards. The agentic piece survives as (a) an extension-registered dashboard contribution attached to Workspace Groups, and (b) a singleton Global Agentic Dashboard pseudo-workspace.

### Core primitive

- **Workspace Group** (renamed from Project) is the sole grouping entity. Lives in core config as `GnarTermConfig.workspaceGroups[]`. Has `id`, `name`, `path`, `color`, and a `groupDashboardEnabled: boolean` (default true) that controls whether the core-provided Group Dashboard workspace exists.
- Auto-adoption: any workspace whose CWD falls under a Workspace Group's `path` (longest-prefix match) is silently adopted (`metadata.groupId` set). Opt-out via `metadata.excludeFromGroupAdoption`.
- "Promote to Workspace Group" takes the active workspace's CWD as the Group's root and adopts all other open workspaces under that root.

### Two new core APIs

1. **Dashboard Contribution API** — extensions register dashboard kinds with `{ id, label, actionLabel, capPerGroup, create(group), isAvailableFor?(group) }`. Each contribution's `create` returns a dashboard workspace whose metadata carries `{ groupId, isDashboard: true, dashboardContributionId }`. The multi-dashboard grid inside a Group renders every matching workspace; the registry drives the "Add X Dashboard" menu items and their caps. Core registers the built-in Group Dashboard with `id: 'group'`, `capPerGroup: 1`.
2. **Pseudo-Workspace API** — extensions register pinned, non-persisted workspaces with `{ id, position, icon, render, settings? }`. These cannot be deleted, renamed, or have tabs/panes added through normal controls. The `settings` component surfaces inside the owning extension's settings panel.

### Agentic extension surface

After refactor, `agentic-orchestrator` makes exactly two register calls:

1. A dashboard contribution with `id: 'agentic'`, `capPerGroup: 1`, scoped to a Workspace Group. Its `create` materializes a dashboard workspace containing `gnar:kanban`, `gnar:agent-list`, and `gnar:task-spawner`.
2. A pseudo-workspace with `id: 'agentic.global'` at `position: 'root-top'` — the Global Agentic Dashboard. Same widgets; scope is global rather than Group-bound.

The `AgentOrchestrator` entity, `parentOrchestratorId`, `baseDir`, `parentProjectId`, root-level orchestrators, and the `AgentOrchestratorRow` component are removed.

### Widget scope via DashboardHostContext

Widgets (`gnar:agent-list`, `gnar:kanban`, `gnar:task-spawner`) read scope from a uniform `DashboardHostContext` provided by the dashboard body — real or pseudo. Scope is derived from metadata: `{ isGlobalAgenticDashboard: true } → global`; `{ groupId }` present → Group-scoped. Widgets receive no props threading; markdown needs no `orchestratorId` field.

### Worktree provenance

Spawned worktrees carry `metadata.spawnedBy: { kind: 'group' | 'global', groupId? }` — replaces `metadata.parentOrchestratorId`. Bot icon derives from presence of `spawnedBy`. Shape supports future "jump to parent dashboard" affordances.

### One-time migration

Schema-versioned, gated on config load:

- `config.projects[]` → `config.workspaceGroups[]`, `groupDashboardEnabled: true`.
- First nested orchestrator per project → that Group's Agentic Dashboard (cap 1); subsequent dropped with a one-time warning log.
- First rootless orchestrator's markdown path → `config.agenticGlobal.markdownPath`; subsequent dropped with a warning log.
- Workspace metadata rewritten: `projectId` → `groupId`; `parentOrchestratorId` → `spawnedBy`.

### Removals

- `src/extensions/project-scope/` — contents move to `src/lib/services/workspace-group-service.ts` and the folder is deleted.
- Secondary-sidebar agent-list tab — the Global Agentic Dashboard replaces it.

## Consequences

Positive:

- One grouping primitive. Users and contributors reason about Workspace Groups; "agentic" is a capability a Group opts into.
- Dashboard contributions are extension-pluggable. Future extensions (issue boards, metrics dashboards, etc.) slot in without core changes.
- Widget code is simpler — scope derives from host context, not props.
- Sidebar real estate consolidates; the Global Agentic Dashboard is pinned rather than competing with rootless orchestrators.

Negative:

- One-time migration is unavoidable. Users with >1 nested orchestrator per project or >1 rootless orchestrator lose content beyond the first. Mitigated by a one-time warning log that lists dropped ids.
- Code churn is significant — a multi-session refactor, sequenced by `docs/implement/progress.md`.
- Tests across `project-scope/__tests__/` and `agentic-orchestrator/__tests__/` are rewritten against the new homes.

## Alternatives considered

1. **Keep both concepts; add shared base class.** Rejected — the duplication is in lifecycle and vocabulary, not just code. A shared base doesn't remove the user-facing dual-container problem.
2. **Fold Projects into Orchestrators (inverse direction).** Rejected — Orchestrators are agent-flavored; most Groups won't use agents. Making agent-scoping the primitive forces that flavor on every Group.
3. **Leave both concepts; rename for clarity only.** Rejected — doesn't address the root duplication and would bake parallelism into the renamed vocabulary.

## References

- Full design: `docs/superpowers/specs/2026-04-20-workspace-groups-unification-design.md` (local, gitignored)
- Sequencing tracker: `docs/implement/progress.md` (local, gitignored)
- Related ADRs: ADR-001 (Extension Architecture), ADR-002 (Extension API Evolution)
