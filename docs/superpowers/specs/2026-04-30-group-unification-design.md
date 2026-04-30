# Group Unification Design

**Date:** 2026-04-30
**Branch:** jrvs/group-unification
**Status:** Approved

## Overview

Unify `WorkspaceGroupEntry` and standalone workspaces into a single concept: every top-level sidebar entry is a workspace container backed by a `WorkspaceGroupEntry`. The container holds exactly one primary (non-worktree) `Workspace` plus zero or more nested worktree `Workspace` objects. All containers get the full dashboard set and a "⎇ Branch" button.

The `worktree-workspaces` extension is absorbed into core as part of this work.

---

## 1. Data Model

One field added to `WorkspaceGroupEntry` in `src/lib/config.ts`:

```typescript
export interface WorkspaceGroupEntry {
  id: string;
  name: string;
  path: string;
  color: string;
  workspaceIds: string[]; // all workspaces: primary + worktrees
  primaryWorkspaceId: string; // NEW — always set, always non-worktree
  isGit: boolean;
  createdAt: string;
  dashboardWorkspaceId?: string;
  locked?: boolean;
}
```

**Invariant:** exactly one `Workspace` per group has no `metadata.worktreePath`, and its `id` matches `primaryWorkspaceId`. The group owns the primary pointer; `WorkspaceMetadata` needs no new fields.

No changes to `Workspace` or `WorkspaceMetadata` types.

---

## 2. Migration

Runs on startup in `workspace-group-service.ts` before any UI renders. Idempotent — groups with `primaryWorkspaceId` already set are skipped.

**Step 1 — Existing groups without `primaryWorkspaceId`:**
Find the first `Workspace` in the group where `metadata.worktreePath` is absent and set it as `primaryWorkspaceId`. If none exists (group contains only worktrees), create a new primary workspace for the group.

**Step 2 — Standalone workspaces** (no `metadata.groupId`):
For each one, create a `WorkspaceGroupEntry` with:

- `name` from workspace name
- `path` from workspace CWD (or empty string if unknown)
- `color` auto-assigned by cycling through the standard group color palette (same logic used when creating a new group today)
- `primaryWorkspaceId` = workspace id
- `workspaceIds` = [workspace.id]

Then stamp the workspace with `metadata.groupId = newGroup.id`.

**Step 3 — Dashboard provisioning:**
Call `provisionAutoDashboardsForGroup()` for any group created or updated in steps 1–2.

**Step 4 — Persist:**
Write migrated `WorkspaceGroupEntry` objects to config immediately so the migration does not re-run on next launch.

---

## 3. Sidebar Rendering

Every top-level sidebar entry renders as a container with a unified row structure. The `WorkspaceGroupSectionContent` component is updated to implement this.

**Container row:**

```
[color block] [primary workspace status dot] [name] [⎇ Branch button] [expand arrow if worktrees exist]
```

- Clicking the row activates the **primary workspace** directly
- The primary workspace is **never listed as a nested row**
- Worktree rows appear nested below, indented, with a branch icon (⎇) and limited status (activity dot + branch name only — no dashboards, no "⎇ Branch" button of their own)
- Dashboard tiles always rendered for every container, even with no worktrees

**Button:** `⎇ Branch` — single action, no dropdown.

---

## 4. Creation Flow

**"New" button (sidebar header):**

- One click, no dialog
- Creates `WorkspaceGroupEntry` + primary `Workspace` immediately with defaults: name "New Workspace", color gray, path unset
- Name field enters inline edit mode; user confirms with Enter
- Dashboards provisioned immediately on creation
- Path and color are configured via the **Settings dashboard** after creation

**"⎇ Branch" button (container row):**

- Opens the worktree creation dialog (branch name, base branch, worktree path) — behavior unchanged from the current worktree extension
- Creates a worktree `Workspace` nested under the container

**Path uniqueness check:**
When a path is set or changed in the Settings dashboard, check against all existing `WorkspaceGroupEntry.path` values (normalized: trailing slashes stripped, symlinks resolved). If a match is found, surface: _"A workspace for this folder already exists — open it instead?"_ The duplicate check does not block the creation moment (path is unset at creation).

---

## 5. Invariant Enforcement

`workspace-group-service.ts` enforces the single-primary invariant:

- `addWorkspaceToGroup(ws, groupId)` — if `ws` has no `metadata.worktreePath`, throws if a non-worktree workspace already exists in the group
- `removeWorkspace(ws)` — blocks removal of the primary workspace unless the entire group is being deleted; worktree workspaces can be removed freely
- No `setPrimaryWorkspace()` method is exposed — the primary is fixed at group creation and cannot be reassigned

---

## 6. Extension Absorption

The `worktree-workspaces` extension (`src/extensions/worktree-workspaces/`) is deleted. Its functionality moves to core:

| Was in extension                              | Moves to                                                        |
| --------------------------------------------- | --------------------------------------------------------------- |
| Worktree creation dialog                      | Core UI component                                               |
| `worktrees:create-workspace` command          | `workspace-group-service.ts` or dedicated `worktree-service.ts` |
| Worktree workspace lifecycle (archive, merge) | Core service                                                    |
| `registerWorkspaceAction("create-worktree")`  | Removed — "⎇ Branch" button is hardcoded                        |
| `when: (ctx) => ctx.isGit` gate               | Removed — button always shown                                   |
| Split-button dropdown in workspace header     | Removed                                                         |

The `registerWorkspaceAction` API remains available for third-party extensions.

---

## 7. Naming Pass (post-implementation)

After core functionality ships, a sweep renames to align terminology with the unified model:

| Before                                | After                                                |
| ------------------------------------- | ---------------------------------------------------- |
| `WorkspaceGroupEntry`                 | `WorkspaceEntry`                                     |
| `workspace-group-service.ts`          | `workspace-service.ts` (absorbing current one)       |
| `WorkspaceGroupSectionContent.svelte` | `WorkspaceSectionContent.svelte`                     |
| "group" in docs, glossary, comments   | "workspace"                                          |
| `getWorkspacesInGroup()`              | `getNestedWorkspaces()` or `getWorktreeWorkspaces()` |

`docs/glossary.md` updated to reflect the unified model as the canonical definition.

---

## Out of Scope

- Changes to the extension API beyond removing `registerWorkspaceAction("create-worktree")`
- Changes to how worktree workspace archival/merge works internally
- Secondary sidebar, dashboard content, or agent orchestration behavior
- Any UI changes to the worktree creation dialog itself
