---
title: "ADR-004: Unified Workspace Shape"
parent: Architecture
nav_order: 7
---

# ADR 004 — Unified Workspace Shape

Status: Accepted
Date: 2026-05-06
Supersedes: prior `WorkspaceScope` (extension-owned, formerly "Project
Scope") and `AgentOrchestrator` (extension-owned) entities; the original
draft of this ADR which proposed the term "Workspace Group" — the
primitive shipped as **Workspace** instead.

## Context

GnarTerm previously carried two parallel "container" concepts:

- **WorkspaceScope** (`src/extensions/project-scope/`, formerly "Project
  Scope") — a path-rooted grouping primitive that claimed workspaces by
  metadata.
- **Agent Orchestrators** (`src/extensions/agentic-orchestrator/`) — an
  agent-flavoured container that owned its own dashboard workspace and
  could nest under a WorkspaceScope.

Each concept had its own root-row renderer, claim-by-metadata machinery,
eagerly-owned dashboard workspace, and lifecycle quirks. A user creating
"an agentic space inside a Workspace" had to reason about two parallel
entity types and their intersection, while the on-disk story split data
across the legacy `parentWorkspaces` array, a per-extension state file
at `~/.config/gnar-term/extensions/workspace-groups/state.json`, and
`state.workspaces[]`.

This ADR records the shape that landed and the rules for adding to it
— not the migration path that got us here.

## Decision

There is exactly one workspace type — **Workspace** — with no subtype
hierarchy. Roots and Branches are the same record discriminated by a
single field: `rootWorkspaceId` present means the record is a Branch,
absent means it is a root Workspace. All workspaces persist in one
canonical array on disk and one canonical store at runtime.

User-facing vocabulary is **Workspace + Branch**. "Parent / child"
terminology does not exist in field names, types, or UI copy; the
back-reference is `rootWorkspaceId`.

### Type shape

`src/lib/types.ts` defines the runtime type. `src/lib/config.ts`
defines the on-disk equivalent (`WorkspaceDef`).

```ts
interface Workspace {
  id: string;
  name: string;
  // Every workspace owns a pane layout — the root's panes are the
  // working area when no Branch is selected.
  paneLayout: SplitNode;
  activePaneId: string | null;

  // Root-only fields (path-rooted Workspaces; absent on Branches)
  path?: string;
  color?: string;
  isGit?: boolean;
  createdAt?: string;
  branchedWorkspaceIds?: string[];
  lastActiveBranchedWorkspaceId?: string;
  dashboardWorkspaceId?: string;

  // Branch discriminant — presence flags this record as a Branch.
  rootWorkspaceId?: string;

  // Worktree-backed Branch fields (provided by the branched-workspaces
  // extension; the worktree-service stays in core)
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  repoPath?: string;

  // Dashboard Branch fields
  isDashboard?: boolean;
  dashboardContributionId?: string;

  // Provenance — drives the bot-icon affordance and "jump to active
  // branch" navigation on the Issues / Kanban widgets.
  spawnedBy?:
    | { kind: "global" }
    | { kind: "workspace"; rootWorkspaceId: string };
  spawnedFromIssues?: number[];

  // Flags
  locked?: boolean;
  pathMissing?: boolean; // runtime-only, not persisted
  autoRunRestoreCommands?: boolean;

  // Open-ended per-extension storage — keyed by extension id so
  // contributions don't collide.
  extensionData?: Record<string, unknown>;
}
```

`BranchedWorkspace` is a structural narrowing helper (a `Workspace` with
`rootWorkspaceId` and `worktreePath` both set), surfaced through the
`isBranchedWorkspace` type guard. There is no separate `DashboardWorkspace`
interface — a dashboard is a Branch with `isDashboard: true` plus a
`dashboardContributionId`.

### Discriminants and invariants

The shape is a flat structural discriminated union. The rules:

| Predicate                                          | Kind             | Required fields           |
| -------------------------------------------------- | ---------------- | ------------------------- |
| `rootWorkspaceId` absent                           | root Workspace   | `path` (when path-rooted) |
| `rootWorkspaceId` present + `worktreePath` present | worktree Branch  | `worktreePath`, `branch`  |
| `rootWorkspaceId` present + `isDashboard === true` | dashboard Branch | `dashboardContributionId` |

Invariants enforced by the runtime:

- A Branch never becomes a root, and a root never becomes a Branch.
  `rootWorkspaceId` is set at creation and is structurally permanent.
- Every Branch's `rootWorkspaceId` resolves to an existing root
  Workspace, OR the Branch is "orphaned" — rendered at top level until
  reattached or archived.
- A root Workspace's `dashboardWorkspaceId` (if present) points to a
  dashboard Branch it owns; that Branch's `dashboardContributionId` is
  the Overview kind.
- `capPerWorkspace` from the Dashboard Contribution registry is enforced
  at create time — duplicates are dropped at restore (`restore-workspaces.ts`
  dedupes by `${rootWorkspaceId}:${contributionId}`).
- A Branch's `rootWorkspaceId` is the canonical membership tag; the
  root's `branchedWorkspaceIds` array exists only to preserve
  user-controlled ordering and is rebuilt from `rootWorkspaceId` on
  startup (`reclaimChildWorkspaces`).

### Pseudo-Workspaces

A separate, non-persisted `PseudoWorkspace` exists for pinned containers
that are not path-rooted and cannot be deleted, renamed, or reordered
through normal UI controls (e.g. the Global Agentic Dashboard). Pseudo-
workspaces are registered by extensions with
`{ id, position, icon, render, settings? }` and live in the pseudo-
workspace registry — they are never written to `state.workspaces[]`.

### Auto-adoption

Workspaces created with a `cwd` are matched against existing root
Workspaces by longest-prefix path match. A match silently adopts the
new workspace as a Branch (`rootWorkspaceId` set on creation). Adoption
can be opted out per-call by callers that explicitly synthesize root
workspaces.

### Persistence

Single canonical array on disk: **`~/.config/gnar-term/state.json` →
`state.workspaces[]: WorkspaceDef[]`**. Roots and Branches are
interleaved; the same discriminant rules above apply on disk.

The `state.workspaces[]` writer is `persistWorkspaces()` in
`src/lib/services/workspace-runtime-service.ts` — exactly one function
emits the array, debounced 2s. Active workspace id is stored alongside
as `state.activeWorkspaceId`.

Sibling state stays separate from `workspaces[]` on purpose:

- `rootRowOrder` — the interleaved sidebar order for roots and pinned
  extension rows. Branches never appear in this list; they live nested
  inside their root's banner. The list is `{ kind, id }` per row, so
  pseudo-workspaces and extension-registered kinds slot in alongside
  workspace rows without core changes.
- `archivedOrder` / `archivedDefs` — archive snapshots and ordering.
- `worktrees.entries` (in `settings.json`, not `state.json`) — git
  worktree records keyed to worktree Branches by `workspaceId`.

The legacy `parentWorkspaces[]` and `activeParentWorkspaceId` keys are
not read by the loader; persisted state from older builds carrying those
fields is silently ignored at restore.

### Dashboard Contribution registry

Extensions register dashboard kinds with
`{ id, label, actionLabel, capPerWorkspace, create(workspace), isAvailableFor?(workspace) }`.
The registry drives the "Add X Dashboard" menu items, their caps, and
restore-time deduplication. Core registers the built-in **Overview**
dashboard with `id: OVERVIEW_DASHBOARD_CONTRIBUTION_ID` (literal value
`"group"`), `capPerWorkspace: 1`. The literal string `"group"` is the
stable contribution id preserved across the legacy
Project/Group → Workspace rename for persisted-data compatibility; it
is not user-facing.

### Sidebar render model

The sidebar renders one row per `rootRowOrder` entry (ordered top-to-
bottom by user). Each `kind: "workspace"` entry renders as a
**banner** — a workspace row block with the root Workspace's name plus
a nested list of its Branches. Pinned pseudo-workspaces and
extension-registered kinds render their own row components in the same
list.

### Extension surface

- **`branched-workspaces`** (included extension) — registers the
  "Branch Workspace" tile action and palette command. Branch creation
  calls into `src/lib/services/worktree-service.ts` in core; the
  service stays in core so existing Branches are operable with the
  extension disabled.
- **`agentic-orchestrator`** — registers the Agentic dashboard
  contribution (cap 1 per Workspace) and the `agentic.global` pseudo-
  workspace. Widgets read scope from a uniform `DashboardHostContext`
  provided by their host (real or pseudo); they take no scope props.

The legacy WorkspaceScope (formerly "Project Scope") extension and the
AgentOrchestrator entity (with `parentOrchestratorId`, `baseDir`,
`parentProjectId`, `AgentOrchestratorRow`) are removed. Historical
field names like `parentProjectId` are preserved here only so consumers
migrating older state can grep for them.

## Consequences

Positive:

- One workspace primitive, one persisted array, one writer. Users
  reason about Workspaces and Branches; "agentic" is a capability a
  Workspace opts into via a dashboard contribution.
- Discriminating on a single `rootWorkspaceId` field means every code
  path can ask "root or Branch?" without consulting auxiliary state.
- A single `state.workspaces[]` writer means concurrency is bounded
  — debounced persist, no cross-store reconciliation in the write
  path.
- Dashboard Contribution + Pseudo-Workspace are both extension-
  pluggable. New dashboard kinds and pinned tools slot in without core
  changes.
- `extensionData` replaces an open-ended metadata bag — extensions can
  store arbitrary state under their id without colliding with core
  fields or with each other.

Negative:

- The `Workspace` interface carries a number of structurally-optional
  fields (`path`, `rootWorkspaceId`, `worktreePath`, `isDashboard`)
  because the discriminated union is not yet enforced via a `kind`
  tag. Type guards (`isBranchedWorkspace`,
  `isDashboardWorkspace(ws, rootWorkspaceId, contribId?)`) bridge the
  gap; converting to a tagged union remains a follow-on simplification.

## Alternatives considered

1. **Keep separate `Workspace`, `Branch`, `Dashboard` types with no
   shared base.** Rejected — duplicates layout, locked, extensionData,
   and lifecycle hooks. The shared base + structural discrimination
   matches actual usage where most consumers care about "any
   workspace" not "branch specifically".
2. **Tag the union with a `kind: "workspace" | "branch" | "dashboard"`
   field.** Deferred, not rejected. Cleanest type story but a sweeping
   migration over persisted state. The structural discriminant works
   today; the tag is a follow-on.
3. **User-facing "Group" container terminology.** Rejected — Workspace
   is the user's mental anchor (it's already in every menu, shortcut,
   and URL). Calling the container something else introduced a
   vocabulary tax with no payoff.

## References

- Type definitions: `src/lib/types.ts`
- On-disk shape: `src/lib/config.ts` (`WorkspaceDef`, `AppState`)
- Single persist writer: `src/lib/services/workspace-runtime-service.ts`
  (`persistWorkspaces`)
- Sidebar order: `src/lib/stores/root-row-order.ts`
- Restore + dedupe: `src/lib/bootstrap/restore-workspaces.ts`
- Branch creation: `src/lib/services/worktree-service.ts`,
  `src/extensions/branched-workspaces/index.ts`
- Related ADRs: ADR-001 (Extension Architecture), ADR-002 (Extension
  API Evolution)
