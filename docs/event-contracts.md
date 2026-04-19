---
title: Event Contracts
parent: Extensions
nav_order: 5
---

# Cross-Extension Event Contracts

Public event protocols for inter-extension communication. Extensions subscribing to these events must declare them in their manifest's `contributes.events` array.

## extension:harness:statusChanged

Emitted by `agentic-orchestrator` when a harness surface changes status.

```typescript
{
  harnessId: string; // Unique ID for this harness instance (generated on mount)
  surfaceId: string; // Core surface ID (for focusSurface / markSurfaceUnread)
  workspaceId: string; // Workspace containing this harness
  status: "running" | "waiting" | "idle" | "closed";
  previousStatus: "running" | "waiting" | "idle" | "closed";
  command: string; // The shell command running in this harness
  cwd: string; // Working directory of the harness
}
```

**Status lifecycle:** `idle` (initial) → `running` (on output) → `waiting` (on OSC notification) → `idle` (on timeout) → `closed` (on surface destroy). Any status can transition to `closed`.

**Subscribers:** `worktree-workspaces` (status dots on worktree entries), `diff-viewer` (Review Agent Changes visibility).

## extension:worktree:merged

Emitted by `worktree-workspaces` when a worktree branch is merged back to its base.

```typescript
{
  worktreePath: string; // Filesystem path to the worktree
  branch: string; // Branch that was merged
  baseBranch: string; // Branch it was merged into
  repoPath: string; // Path to the main repository
  workspaceId: string; // Workspace ID of the merged worktree
}
```

**Subscribers:** `diff-viewer` (auto-open merge diff summary).

## extension:project:dashboard-opened

Emitted by `project-scope` when a project dashboard overlay is opened.

```typescript
{
  projectId: string; // ID of the project whose dashboard was opened
}
```

**Subscribers:** None currently — available for extensions that want to react to dashboard visibility (e.g., refreshing project-specific data).
