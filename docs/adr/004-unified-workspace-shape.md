---
title: "ADR-004: Unified Workspace Shape"
parent: Architecture
nav_order: 7
---

# ADR 004 — Unified Workspace Shape

Status: Accepted
Date: 2026-05-05
Supersedes: prior `Project` (extension-owned) and `AgentOrchestrator` (extension-owned) entities; the original draft of this ADR which proposed the term "Workspace Group" — the primitive shipped as **Workspace** instead.

## Context

GnarTerm previously carried two parallel "container" concepts:

- **Projects** (`src/extensions/project-scope/`) — a path-rooted grouping primitive that claimed workspaces by `metadata.projectId`.
- **Agent Orchestrators** (`src/extensions/agentic-orchestrator/`) — an agent-flavoured container that owned its own dashboard workspace and could nest under a Project.

Each concept had its own root-row renderer, claim-by-metadata machinery, eagerly-owned dashboard workspace, and lifecycle quirks. A user creating "an agentic space inside a project" had to reason about two parallel entity types and their intersection, while the on-disk story split workspace data across the legacy `parentWorkspaces` array, a per-extension state file at `~/.config/gnar-term/extensions/workspace-groups/state.json`, and `state.workspaces[]`.

The goal of this ADR is to record the shape that landed and the rules for adding to it — not the migration path that got us here.

## Decision

There is exactly one container primitive — **Workspace** — and two child kinds that ride on it. All three persist in a single canonical array. User-facing vocabulary is **Workspace + Branch**; "parent / child" terminology survives in field names and internal types but is not exposed in UI.

### Type shape

`src/lib/types.ts` defines the runtime types. `src/lib/config.ts` defines the on-disk equivalents.

```ts
// Top-level: project-bound container shown in the sidebar.
// Owns project-level fields (path, color, isGit, createdAt) and 0..N
// children. Has its own pane layout — when no Branch is selected, the
// Workspace itself is the working area.
interface Workspace {
  id: string;
  name: string;
  splitRoot: SplitNode;
  activePaneId: string | null;
  path?: string;
  color?: string;
  isGit?: boolean;
  createdAt?: string;
  // Navigation / flags
  lastActiveBranchedWorkspaceId?: string;
  dashboardWorkspaceId?: string;
  locked?: boolean;
  autoRunRestoreCommands?: boolean;
  // Extension data — open-ended bag scoped to extension ids
  extensionData?: Record<string, unknown>;
}

// Worktree-backed Workspace variant. Created by the branched-workspaces
// extension; the underlying worktree-service is in core so existing
// branches remain operable when the extension is disabled.
interface BranchedWorkspace extends Workspace {
  parentWorkspaceId: string;
  worktreePath: string;
  branch: string;
  baseBranch?: string;
  repoPath?: string;
}

// Dashboard surface attached to a Workspace. Driven by the Dashboard
// Contribution registry — extensions register kinds with capPerGroup
// caps; the built-in Overview dashboard ships in core.
interface DashboardWorkspace extends Workspace {
  parentWorkspaceId: string;
  isDashboard: true;
  dashboardContributionId: string;
}

// Internal union — NOT exposed in user-facing copy.
type ChildWorkspace = BranchedWorkspace | DashboardWorkspace;
```

`ChildWorkspace` exists as a runtime abstraction because Branches and Dashboards share the same back-reference (`parentWorkspaceId`), the same lifecycle (created/closed under their owning Workspace, archived with it, surfaced in the same tab strip), and the same set of consumers (sidebar nesting, restore filtering, claim bookkeeping). Code that needs to reason about "things owned by a Workspace" works against the union; code that needs to discriminate uses the structural marker (`worktreePath` vs `isDashboard`).

### Pseudo-Workspaces

A separate, non-persisted `PseudoWorkspace` exists for pinned containers that are not project-bound and cannot be deleted, renamed, or reordered through normal UI controls (e.g. the Global Agentic Dashboard at `position: "root-top"`). Pseudo-workspaces are registered by extensions with `{ id, position, icon, render, settings? }` and live in the pseudo-workspace registry — they are never written to `state.workspaces[]`.

### Discriminants and invariants

The shape is a structural discriminated union. The rules:

| Predicate                                            | Kind               | Required fields             |
| ---------------------------------------------------- | ------------------ | --------------------------- |
| `parentWorkspaceId` absent                           | Workspace          | `path` (when project-bound) |
| `parentWorkspaceId` present + `worktreePath` present | BranchedWorkspace  | `worktreePath`, `branch`    |
| `parentWorkspaceId` present + `isDashboard === true` | DashboardWorkspace | `dashboardContributionId`   |

Invariants enforced by the runtime:

- Every `ChildWorkspace.parentWorkspaceId` resolves to an existing Workspace, OR the child is "orphaned" (parent missing — rendered at top level until reattached or archived).
- A Workspace's `dashboardWorkspaceId` (if present) points to a `DashboardWorkspace` it owns; that dashboard's `dashboardContributionId` is the Overview kind.
- `capPerGroup` from the Dashboard Contribution registry is enforced at create time — duplicates are dropped at restore (`restore-workspaces.ts` dedupes by `${parentWorkspaceId}:${contributionId}`).

### Auto-adoption

Workspaces created with a `cwd` are matched against existing Workspaces by longest-prefix path match. A match silently adopts the new workspace as a Branch (`metadata.parentWorkspaceId` set on creation). Adoption can be opted out per-call by callers that explicitly synthesize top-level workspaces.

### Worktree provenance

When a Branch is spawned by a dashboard rather than direct user action, `metadata.spawnedBy: { kind: "global" | "workspace", parentWorkspaceId? }` records which dashboard. The bot-icon affordance and "jump to active branch" navigation read this field. `parentOrchestratorId` (the pre-unification name) does not exist.

### Persistence

Single canonical array on disk: **`~/.config/gnar-term/state.json` → `state.workspaces[]: WorkspaceDef[]`**. All three kinds are interleaved; the same discriminant rules above apply to the on-disk shape.

The `state.workspaces[]` writer is `persistWorkspaces()` in `src/lib/services/workspace-runtime-service.ts` — exactly one function emits the array, debounced 2s. Active workspace id is stored alongside as `state.activeWorkspaceId`.

Sibling state lives in `AppState` and stays separate from `workspaces[]` on purpose:

- `rootRowOrder` / `archivedOrder` / `archivedDefs` — sidebar ordering and archive snapshots.
- `worktrees.entries` (in `settings.json`, not `state.json`) — git worktree records keyed to BranchedWorkspaces by `workspaceId`.

The legacy `parentWorkspaces[]` and `activeParentWorkspaceId` keys are migrated forward by `migrateLegacyWorkspaces` (`src/lib/bootstrap/migrate-legacy-workspaces.ts`) on first load and dropped from disk thereafter.

### Dashboard Contribution registry

Extensions register dashboard kinds with `{ id, label, actionLabel, capPerGroup, create(workspace), isAvailableFor?(workspace) }`. The registry drives the "Add X Dashboard" menu items, their caps, and restore-time deduplication. Core registers the built-in **Overview** dashboard with `id: "group"`, `capPerGroup: 1` — the name "group" is the stable contribution id and is not a user-facing string.

### Extension surface

- **`branched-workspaces`** (included extension) — registers the "Branch Workspace" tile action and palette command. Branch creation calls into `src/lib/services/worktree-service.ts` in core; the service stays in core so existing Branches are operable with the extension disabled.
- **`agentic-orchestrator`** — registers the Agentic dashboard contribution (cap 1 per Workspace) and the `agentic.global` pseudo-workspace. Widgets read scope from a uniform `DashboardHostContext` provided by their host (real or pseudo); they take no scope props.

Project Scope and the AgentOrchestrator entity (with `parentOrchestratorId`, `baseDir`, `parentProjectId`, `AgentOrchestratorRow`) are removed.

## Consequences

Positive:

- One container primitive. Users reason about Workspaces and Branches; "agentic" is a capability a Workspace opts into via a dashboard contribution.
- Discriminated union means new code paths can be type-narrowed against `ChildWorkspace` rather than calling structural guards.
- A single `state.workspaces[]` writer means concurrency is bounded — debounced persist, no cross-store reconciliation in the write path.
- Dashboard Contribution + Pseudo-Workspace are both extension-pluggable. New dashboard kinds and pinned tools slot in without core changes.

Negative:

- The `Workspace` interface carries a number of structurally-optional fields (`path`, `parentWorkspaceId`, `worktreePath`, `isDashboard`) because the discriminated union is not yet enforced via a `kind` tag. Type guards (`isBranchedWorkspace`, `isChildWorkspace`) bridge the gap; converting to a tagged union is a follow-on simplification.
- `parentWorkspaceId` is the universal back-reference even though "parent / child workspace" is not user vocabulary. Renaming to a neutral `workspaceId` is desirable but high-churn (~377 occurrences across services, tests, and extension code) and deferred.

## Alternatives considered

1. **Keep separate `Workspace`, `Branch`, `Dashboard` types with no shared base.** Rejected — duplicates layout, locked, extensionData, and lifecycle hooks. The shared base + structural discrimination matches actual usage where most consumers care about "any workspace" not "branch specifically".
2. **Tag the union with a `kind: "project" | "branch" | "dashboard"` field.** Deferred, not rejected. Cleanest type story but a sweeping migration over persisted state. The structural discriminant works today; the tag is a follow-on.
3. **User-facing "Group" or "Project" terminology.** Rejected — Workspace is the user's mental anchor (it's already in every menu, shortcut, and URL). Calling the container something else introduced a vocabulary tax with no payoff.

## References

- Type definitions: `src/lib/types.ts`
- On-disk shape: `src/lib/config.ts` (`WorkspaceDef`, `AppState`)
- Single persist writer: `src/lib/services/workspace-runtime-service.ts` (`persistWorkspaces`)
- Migration: `src/lib/bootstrap/migrate-legacy-workspaces.ts`
- Restore + dedupe: `src/lib/bootstrap/restore-workspaces.ts`
- Branched workspace creation: `src/lib/services/worktree-service.ts`, `src/extensions/branched-workspaces/index.ts`
- Related ADRs: ADR-001 (Extension Architecture), ADR-002 (Extension API Evolution)
