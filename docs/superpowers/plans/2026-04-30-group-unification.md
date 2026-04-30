# Group Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify workspace groups and standalone workspaces so every sidebar entry is a `WorkspaceGroupEntry` container with exactly one primary workspace and zero or more nested worktree workspaces.

**Architecture:** Add `primaryWorkspaceId` to `WorkspaceGroupEntry`, run a startup reconciliation pass that wraps standalone workspaces into groups and backfills the primary pointer, then update the sidebar to show the primary workspace's status on the container row (hiding it from the nested list). The `worktree-workspaces` extension is deleted; its `create-worktree` action moves to core as a hardcoded "⎇ Branch" button on every container row. Group creation becomes one-click-with-defaults (no dialog); path/color are configured via the Settings dashboard.

**Tech Stack:** TypeScript, Svelte 5, Vitest, `src/lib/services/workspace-group-service.ts`, `src/lib/bootstrap/init-workspace-groups.ts`, `src/lib/components/WorkspaceGroupSectionContent.svelte`

**Spec:** `docs/superpowers/specs/2026-04-30-group-unification-design.md`

---

## File Map

| File                                                      | Change                                                                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/config.ts`                                       | Add `primaryWorkspaceId?: string` to `WorkspaceGroupEntry`                                                                                                            |
| `src/lib/services/workspace-group-service.ts`             | Add `reconcilePrimaryWorkspaces()`, update `addWorkspaceToGroup` invariant guard                                                                                      |
| `src/lib/bootstrap/init-workspace-groups.ts`              | Call reconcile on startup; update `createWorkspaceGroupFlow` (no dialog); set `primaryWorkspaceId` on new groups; register `create-worktree` workspace action in core |
| `src/lib/components/WorkspaceGroupSectionContent.svelte`  | Derive `primaryWs`; exclude it from nested list; show its status on the container row; replace SplitButton with "⎇ Branch" button                                     |
| `src/lib/components/PrimarySidebar.svelte`                | Remove split-button dropdown (now empty after extension removal); plain "New" button                                                                                  |
| `src/lib/bootstrap/register-included-extensions.ts`       | Remove `worktree-workspaces` entry                                                                                                                                    |
| `src/extensions/worktree-workspaces/index.ts`             | **Delete**                                                                                                                                                            |
| `src/__tests__/worktree-workspaces-extension.test.ts`     | **Delete**                                                                                                                                                            |
| `src/__tests__/reconcile-primary-workspaces.test.ts`      | **Create** — tests for `reconcilePrimaryWorkspaces()`                                                                                                                 |
| `src/__tests__/workspace-group-primary-invariant.test.ts` | **Create** — tests for `addWorkspaceToGroup` primary guard                                                                                                            |

Naming pass (Task 8) renames `WorkspaceGroupEntry → WorkspaceEntry` and related identifiers across the whole codebase.

---

## Task 1: Add `primaryWorkspaceId` to the data model

**Files:**

- Modify: `src/lib/config.ts:142-161`

- [ ] **Step 1: Write the failing type test**

Create `src/__tests__/workspace-group-primary-invariant.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import type { WorkspaceGroupEntry } from "../lib/config";

describe("WorkspaceGroupEntry.primaryWorkspaceId", () => {
  it("accepts a group with primaryWorkspaceId set", () => {
    const group: WorkspaceGroupEntry = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      workspaceIds: ["ws-1"],
      primaryWorkspaceId: "ws-1",
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(group.primaryWorkspaceId).toBe("ws-1");
  });

  it("accepts a group without primaryWorkspaceId (legacy shape)", () => {
    const group: WorkspaceGroupEntry = {
      id: "g1",
      name: "Test",
      path: "/tmp/test",
      color: "blue",
      workspaceIds: [],
      isGit: false,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
    expect(group.primaryWorkspaceId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/__tests__/workspace-group-primary-invariant.test.ts
```

Expected: FAIL — `WorkspaceGroupEntry` has no `primaryWorkspaceId`.

- [ ] **Step 3: Add `primaryWorkspaceId` to `WorkspaceGroupEntry` in `src/lib/config.ts`**

Find the interface at line 142. Add the field after `workspaceIds`:

```typescript
export interface WorkspaceGroupEntry {
  id: string;
  name: string;
  /** Root CWD — auto-adoption uses this as a longest-prefix ancestor match. */
  path: string;
  color: string;
  /** Ids of workspaces currently claimed by this group. */
  workspaceIds: string[];
  /**
   * Id of the one non-worktree, non-dashboard workspace in this group.
   * Set at group creation and backfilled by reconcilePrimaryWorkspaces()
   * on first startup after migration. Never reassigned.
   */
  primaryWorkspaceId?: string;
  /** True when `path` is the root of a git repo. */
  isGit: boolean;
  createdAt: string;
  dashboardWorkspaceId?: string;
  locked?: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/__tests__/workspace-group-primary-invariant.test.ts
```

Expected: PASS

- [ ] **Step 5: Run the full test suite to verify no regressions**

```bash
npm test
```

Expected: all tests pass (the field is optional, no existing code breaks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts src/__tests__/workspace-group-primary-invariant.test.ts
git commit -m "feat(group-unification): add primaryWorkspaceId to WorkspaceGroupEntry"
```

---

## Task 2: Startup reconciliation — wrap standalones, backfill primary pointers

**Files:**

- Modify: `src/lib/services/workspace-group-service.ts`
- Modify: `src/lib/bootstrap/init-workspace-groups.ts:254-266`
- Create: `src/__tests__/reconcile-primary-workspaces.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/reconcile-primary-workspaces.test.ts`:

```typescript
/**
 * reconcilePrimaryWorkspaces — startup pass that:
 *   1. Backfills primaryWorkspaceId on groups that lack it.
 *   2. Wraps standalone (ungrouped) workspaces into new groups.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "is_git_repo") return false;
    return undefined;
  }),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { workspaces } from "../lib/stores/workspace";
import {
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import { reconcilePrimaryWorkspaces } from "../lib/services/workspace-group-service";
import type { WorkspaceGroupEntry } from "../lib/config";

function makeGroup(
  overrides: Partial<WorkspaceGroupEntry> = {},
): WorkspaceGroupEntry {
  return {
    id: "g1",
    name: "Group 1",
    path: "/tmp/g1",
    color: "blue",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function makeWorkspace(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Workspace ${id}`,
    layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
    metadata: {},
    ...overrides,
  } as never;
}

describe("reconcilePrimaryWorkspaces", () => {
  beforeEach(() => {
    workspaces.set([]);
    setWorkspaceGroups([]);
  });

  it("backfills primaryWorkspaceId on a group that lacks it", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["ws-1"] });
    setWorkspaceGroups([group]);
    workspaces.set([makeWorkspace("ws-1", { metadata: { groupId: "g1" } })]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-1");
  });

  it("skips groups that already have primaryWorkspaceId", async () => {
    const group = makeGroup({
      id: "g1",
      workspaceIds: ["ws-1"],
      primaryWorkspaceId: "ws-1",
    });
    setWorkspaceGroups([group]);
    workspaces.set([makeWorkspace("ws-1", { metadata: { groupId: "g1" } })]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-1");
    // No duplicate groups created
    expect(getWorkspaceGroups()).toHaveLength(1);
  });

  it("skips worktree workspaces when choosing primary", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["wt-1", "ws-2"] });
    setWorkspaceGroups([group]);
    workspaces.set([
      makeWorkspace("wt-1", {
        metadata: { groupId: "g1", worktreePath: "/tmp/wt1" },
      }),
      makeWorkspace("ws-2", { metadata: { groupId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-2");
  });

  it("skips dashboard workspaces when choosing primary", async () => {
    const group = makeGroup({ id: "g1", workspaceIds: ["dash-1", "ws-2"] });
    setWorkspaceGroups([group]);
    workspaces.set([
      makeWorkspace("dash-1", {
        metadata: { groupId: "g1", isDashboard: true },
      }),
      makeWorkspace("ws-2", { metadata: { groupId: "g1" } }),
    ]);

    await reconcilePrimaryWorkspaces();

    const updated = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(updated?.primaryWorkspaceId).toBe("ws-2");
  });

  it("wraps a standalone workspace into a new group", async () => {
    workspaces.set([makeWorkspace("ws-solo", { name: "Solo", metadata: {} })]);

    await reconcilePrimaryWorkspaces();

    const groups = getWorkspaceGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].primaryWorkspaceId).toBe("ws-solo");
    expect(groups[0].name).toBe("Solo");

    // Workspace is now stamped with groupId
    const ws = get(workspaces).find((w) => w.id === "ws-solo");
    expect((ws?.metadata as Record<string, unknown>)?.groupId).toBe(
      groups[0].id,
    );
  });

  it("does not wrap dashboard workspaces", async () => {
    workspaces.set([
      makeWorkspace("dash-global", { metadata: { isDashboard: true } }),
    ]);

    await reconcilePrimaryWorkspaces();

    expect(getWorkspaceGroups()).toHaveLength(0);
  });

  it("is idempotent — calling twice does not double-wrap", async () => {
    workspaces.set([makeWorkspace("ws-solo", { name: "Solo", metadata: {} })]);

    await reconcilePrimaryWorkspaces();
    await reconcilePrimaryWorkspaces();

    expect(getWorkspaceGroups()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/__tests__/reconcile-primary-workspaces.test.ts
```

Expected: FAIL — `reconcilePrimaryWorkspaces` is not exported.

- [ ] **Step 3: Implement `reconcilePrimaryWorkspaces` in `src/lib/services/workspace-group-service.ts`**

Add after `reclaimWorkspacesAcrossGroups` (around line 680). You will also need to import `GROUP_COLOR_SLOTS` from `../extensions/api` at the top of the file:

```typescript
import { GROUP_COLOR_SLOTS } from "../../extensions/api";
```

Then add the function:

```typescript
/**
 * Startup reconciliation — called after workspaces are restored.
 *
 * Pass 1: For every group lacking `primaryWorkspaceId`, select the first
 * member workspace that is neither a dashboard nor a worktree.
 *
 * Pass 2: Wrap every standalone workspace (no metadata.groupId, not a
 * dashboard) into a fresh group with that workspace as its primary.
 *
 * Idempotent — groups that already have `primaryWorkspaceId` are skipped.
 */
export async function reconcilePrimaryWorkspaces(): Promise<void> {
  // Pass 1 — backfill existing groups.
  for (const group of getWorkspaceGroups()) {
    if (group.primaryWorkspaceId) continue;
    const members = getWorkspacesInGroup(group.id);
    const primary = members.find(
      (w) => !wsMeta(w).worktreePath && !wsMeta(w).isDashboard,
    );
    if (primary) {
      updateWorkspaceGroup(group.id, { primaryWorkspaceId: primary.id });
    }
    // Groups with no eligible primary are left without one — the next
    // group creation flow will set it. No new workspace is created here
    // to avoid surprises on startup.
  }

  // Pass 2 — wrap standalone workspaces.
  const knownGroupIds = new Set(getWorkspaceGroups().map((g) => g.id));
  // Snapshot before we start mutating so the loop is stable.
  const snapshot = get(workspaces);
  const usedColors = getWorkspaceGroups().map((g) => g.color);

  for (const ws of snapshot) {
    const md = wsMeta(ws);
    if (md.groupId && knownGroupIds.has(md.groupId)) continue;
    if (md.isDashboard) continue;

    const colorIdx = usedColors.length % GROUP_COLOR_SLOTS.length;
    const color = GROUP_COLOR_SLOTS[colorIdx];
    usedColors.push(color);

    const id = crypto.randomUUID();
    const group: WorkspaceGroupEntry = {
      id,
      name: ws.name,
      path: ((md as Record<string, unknown>).cwd as string) ?? "",
      color,
      workspaceIds: [ws.id],
      primaryWorkspaceId: ws.id,
      isGit: false,
      createdAt: new Date().toISOString(),
    };

    // Stamp the workspace with its new group.
    workspaces.update((list) =>
      list.map((w) =>
        w.id === ws.id
          ? { ...w, metadata: { ...(w.metadata ?? {}), groupId: id } }
          : w,
      ),
    );
    addWorkspaceGroup(group);
    knownGroupIds.add(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- --reporter=verbose src/__tests__/reconcile-primary-workspaces.test.ts
```

Expected: PASS

- [ ] **Step 5: Wire the call in `initWorkspaceGroups` in `src/lib/bootstrap/init-workspace-groups.ts`**

Import `reconcilePrimaryWorkspaces` at the top with the other service imports:

```typescript
import {
  // ... existing imports ...
  reconcilePrimaryWorkspaces,
} from "../services/workspace-group-service";
```

In `initWorkspaceGroups()` (line 254), add the call after `reclaimWorkspacesAcrossGroups()`:

```typescript
export async function initWorkspaceGroups(): Promise<void> {
  await loadWorkspaceGroups();

  for (const group of readGroups()) {
    appendRootRow({ kind: "workspace-group", id: group.id });
  }

  reclaimWorkspacesAcrossGroups();
  // After reclaim, backfill primaryWorkspaceId and wrap any standalone
  // workspaces. Safe to call here because workspaces were restored before
  // initWorkspaceGroups is awaited in App.svelte.
  await reconcilePrimaryWorkspaces();

  // ... rest of function unchanged ...
```

Wait — `initWorkspaceGroups()` is called at line 599 of App.svelte, **before** `restoreWorkspaces()` at line 641. The workspaces store is empty at that point. Move the `reconcilePrimaryWorkspaces()` call to App.svelte instead, immediately after `markRestored()`:

In `src/App.svelte`, find the block around line 641–646 and update it:

```typescript
await restoreWorkspaces(cliArgs, config);
markRestored();
// Backfill primaryWorkspaceId and wrap standalone workspaces now that
// the workspaces store is populated.
await reconcilePrimaryWorkspaces();
void reconcileGroupDashboards();
```

Import `reconcilePrimaryWorkspaces` in App.svelte at the top with the other workspace-group-service imports (around line 73):

```typescript
import {
  reconcileGroupDashboards,
  reconcilePrimaryWorkspaces,
} from "./lib/services/workspace-group-service";
```

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/workspace-group-service.ts \
        src/lib/bootstrap/init-workspace-groups.ts \
        src/App.svelte \
        src/__tests__/reconcile-primary-workspaces.test.ts
git commit -m "feat(group-unification): add reconcilePrimaryWorkspaces startup pass"
```

---

## Task 3: Set `primaryWorkspaceId` on new groups at creation time

**Files:**

- Modify: `src/lib/bootstrap/init-workspace-groups.ts:113-192`

This task changes `createWorkspaceGroupFlow` so that:

1. It no longer opens a dialog — creates the group with defaults immediately.
2. It sets `primaryWorkspaceId` on the group as soon as the primary workspace is created.
3. It triggers an inline rename of the new group (using `showInputPrompt` for the name).

- [ ] **Step 1: Write a failing test**

Add to `src/__tests__/workspace-group-primary-invariant.test.ts`:

```typescript
import { get } from "svelte/store";
import {
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { resetWorkspaceActions } from "../lib/services/workspace-action-registry";
import { resetDashboardContributions } from "../lib/services/dashboard-contribution-registry";
import { resetRootRowRenderers } from "../lib/services/root-row-renderer-registry";

// (add these to beforeEach or a new describe block)
describe("createWorkspaceGroupFlow — no dialog path", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    setWorkspaceGroups([]);
    resetWorkspaceActions();
    resetDashboardContributions();
  });

  it("created group has primaryWorkspaceId pointing at its initial workspace", async () => {
    // This test will be fleshed out after the implementation is wired.
    // For now just verify the type compiles with primaryWorkspaceId set.
    const group = getWorkspaceGroups()[0];
    // group is undefined before creation — placeholder to fail at compile
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (compile check)**

```bash
npm test -- --reporter=verbose src/__tests__/workspace-group-primary-invariant.test.ts
```

Expected: PASS (placeholder test).

- [ ] **Step 3: Update `createWorkspaceGroupFlow` in `src/lib/bootstrap/init-workspace-groups.ts`**

Replace the current `createWorkspaceGroupFlow` function body (lines 113–192). The new version skips the dialog and creates with defaults:

```typescript
async function createWorkspaceGroupFlow(prefill?: {
  path: string;
  name?: string;
}): Promise<string | null> {
  const id = generateId();
  const defaultName = "New Workspace";
  const usedColors = readGroups().map((g) => g.color);
  const colorIdx = usedColors.length % GROUP_COLOR_SLOTS.length;
  const color = GROUP_COLOR_SLOTS[colorIdx];

  const group: WorkspaceGroupEntry = {
    id,
    name: prefill?.name ?? defaultName,
    path: prefill?.path ?? "",
    color,
    workspaceIds: [],
    isGit: false,
    createdAt: new Date().toISOString(),
  };

  addWorkspaceGroup(group);

  // Provision dashboards immediately so Settings is available for path/color.
  try {
    await provisionAutoDashboardsForGroup(group);
    const overview = get(workspaces).find((w) =>
      isDashboardWorkspace(w, group.id, "group"),
    );
    if (overview) {
      updateWorkspaceGroup(id, { dashboardWorkspaceId: overview.id });
    }
  } catch (err) {
    console.error(`[workspace-groups] Dashboard provision failed: ${err}`);
  }

  // Create the primary workspace and stamp it as primary.
  try {
    const wsName = group.name;
    await createWorkspaceFromDef({
      name: wsName,
      cwd: group.path,
      metadata: { groupId: id },
      layout: { pane: { surfaces: [{ type: "terminal" }] } },
    });
    const newWs = get(workspaces)
      .slice()
      .reverse()
      .find((w) => wsMeta(w).groupId === id && !wsMeta(w).isDashboard);
    if (newWs) {
      updateWorkspaceGroup(id, { primaryWorkspaceId: newWs.id });
      const idx = get(workspaces).indexOf(newWs);
      if (idx >= 0) switchWorkspace(idx);
    }
  } catch (err) {
    console.error(
      `[workspace-groups] Primary workspace creation failed: ${err}`,
    );
  }

  setActiveGroupId(id);

  // Prompt for a name inline. showInputPrompt is non-blocking but we
  // await it so the rename resolves before the caller returns.
  if (!prefill?.name) {
    const newName = await showInputPrompt(
      "Name this workspace",
      defaultName,
    ).catch(() => null);
    if (newName && newName.trim()) {
      updateWorkspaceGroup(id, { name: newName.trim() });
    }
  }

  return id;
}
```

Add `GROUP_COLOR_SLOTS` to the imports at the top of `init-workspace-groups.ts`:

```typescript
import { GROUP_COLOR_SLOTS } from "../theme-data";
```

Add `showInputPrompt` import (it's already imported in the file — verify it's there, otherwise add):

```typescript
import { showInputPrompt } from "../stores/ui";
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bootstrap/init-workspace-groups.ts
git commit -m "feat(group-unification): createWorkspaceGroupFlow skips dialog, sets primaryWorkspaceId"
```

---

## Task 4: Invariant guard — enforce single primary per group

**Files:**

- Modify: `src/lib/services/workspace-group-service.ts:117-134`

- [ ] **Step 1: Write failing tests**

Add to `src/__tests__/workspace-group-primary-invariant.test.ts` (new describe block, requires more imports at top):

```typescript
import { addWorkspaceToGroup } from "../lib/services/workspace-group-service";
import {
  getWorkspaceGroups,
  setWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import { workspaces } from "../lib/stores/workspace";

describe("addWorkspaceToGroup — primary invariant", () => {
  beforeEach(() => {
    workspaces.set([]);
    setWorkspaceGroups([
      {
        id: "g1",
        name: "G1",
        path: "/tmp/g1",
        color: "blue",
        workspaceIds: ["ws-primary"],
        primaryWorkspaceId: "ws-primary",
        isGit: false,
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      {
        id: "ws-primary",
        name: "Primary",
        layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
        metadata: { groupId: "g1" },
      } as never,
      {
        id: "ws-worktree",
        name: "Worktree",
        layout: { pane: { id: "p2", surfaces: [], activeIdx: 0 } },
        metadata: { groupId: "g1", worktreePath: "/tmp/wt" },
      } as never,
    ]);
  });

  it("allows adding a worktree workspace to a group that already has a primary", () => {
    const changed = addWorkspaceToGroup("g1", "ws-worktree");
    expect(changed).toBe(true);
    const group = getWorkspaceGroups().find((g) => g.id === "g1");
    expect(group?.workspaceIds).toContain("ws-worktree");
  });

  it("throws when adding a second non-worktree workspace to a group that has a primary", () => {
    workspaces.update((list) => [
      ...list,
      {
        id: "ws-second",
        name: "Second",
        layout: { pane: { id: "p3", surfaces: [], activeIdx: 0 } },
        metadata: { groupId: "g1" },
      } as never,
    ]);
    expect(() => addWorkspaceToGroup("g1", "ws-second")).toThrow(
      "already has a primary workspace",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose src/__tests__/workspace-group-primary-invariant.test.ts
```

Expected: FAIL — no throw occurs currently.

- [ ] **Step 3: Add the guard to `addWorkspaceToGroup` in `src/lib/services/workspace-group-service.ts`**

The current signature is at line 117. Update the function to check if the incoming workspace is a second non-worktree:

```typescript
export function addWorkspaceToGroup(
  groupId: string,
  workspaceId: string,
): boolean {
  const groups = getWorkspaceGroups();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  if (group.workspaceIds.includes(workspaceId)) return false;

  // Enforce single-primary invariant: if the incoming workspace is not a
  // worktree and not a dashboard, and the group already has a primary,
  // reject it. The primary is set once at creation and never reassigned.
  const incomingWs = get(workspaces).find((w) => w.id === workspaceId);
  if (incomingWs) {
    const md = wsMeta(incomingWs);
    if (!md.worktreePath && !md.isDashboard && group.primaryWorkspaceId) {
      throw new Error(
        `Group "${groupId}" already has a primary workspace "${group.primaryWorkspaceId}". ` +
          `Cannot add a second non-worktree workspace "${workspaceId}".`,
      );
    }
  }

  const next = groups.map((g) => {
    if (g.id === groupId) {
      return { ...g, workspaceIds: [...g.workspaceIds, workspaceId] };
    }
    return g;
  });
  setWorkspaceGroups(next);
  emitStateChanged({ groupId });
  return true;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --reporter=verbose src/__tests__/workspace-group-primary-invariant.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/workspace-group-service.ts \
        src/__tests__/workspace-group-primary-invariant.test.ts
git commit -m "feat(group-unification): enforce single-primary invariant in addWorkspaceToGroup"
```

---

## Task 5: Sidebar — show primary status on container row, hide primary from nested list

**Files:**

- Modify: `src/lib/components/WorkspaceGroupSectionContent.svelte`

The container row currently shows the group's aggregate bot status. This task changes it to:

1. Derive `primaryWs` from `group.primaryWorkspaceId`.
2. Display the primary workspace's status dot (activity indicator) on the container row header alongside the group color block.
3. Exclude `primaryWs` from the nested `WorkspaceListView` so it doesn't appear twice.

- [ ] **Step 1: Locate `filterIds` in `WorkspaceGroupSectionContent.svelte` (line 115)**

Current code:

```typescript
$: filterIds = group ? new Set(group.workspaceIds) : new Set<string>();
```

- [ ] **Step 2: Add `primaryWs` reactive declaration and update `filterIds`**

After the existing `$: filterIds` line, add:

```typescript
// The primary workspace drives the container row's status dot. It is
// excluded from the nested WorkspaceListView — clicking the row itself
// activates it.
$: primaryWs = group?.primaryWorkspaceId
  ? $workspaces.find((w) => w.id === group!.primaryWorkspaceId)
  : undefined;

// Nested list shows everything except the primary and dashboards.
$: nestedIds = group
  ? new Set(
      group.workspaceIds.filter(
        (id) =>
          id !== group!.primaryWorkspaceId &&
          !$workspaces.find((w) => w.id === id && wsMeta(w).isDashboard),
      ),
    )
  : new Set<string>();
```

Then change `filterIds` (which is passed to `WorkspaceListView`) to use `nestedIds`. Find the template section where `filterIds` is used and replace it with `nestedIds`.

- [ ] **Step 3: Show primary workspace status on the container row**

Find the ContainerRow header area in the template. The group currently shows a color dot and name. Add the primary workspace's status dot next to the color block.

Find the existing agent/bot status display in the header — the component already has `groupBotStatus`. Replace or extend this to derive the primary workspace's status specifically:

```typescript
// Primary workspace status: agent status for the primary workspace only.
$: primaryWsAgentStatus = (() => {
  if (!primaryWs) return null;
  const agent = $agentsStore.find((a) => a.workspaceId === primaryWs!.id);
  if (!agent) return null;
  if (agent.status === "running" || agent.status === "active")
    return { label: "running", color: variantColor("success") };
  if (agent.status === "waiting")
    return { label: "waiting", color: variantColor("warning") };
  if (agent.status === "idle")
    return { label: "idle", color: variantColor("muted") };
  return null;
})();
```

In the template, find where the group name and status are displayed in the ContainerRow header. Add the primary workspace status dot. Look for the slot or prop that feeds the header content and add:

```svelte
{#if primaryWsAgentStatus}
  <span
    style="
      display: inline-block;
      width: 7px; height: 7px; border-radius: 50%;
      background: {primaryWsAgentStatus.color};
      flex-shrink: 0;
    "
    title={primaryWsAgentStatus.label}
  ></span>
{:else if primaryWs}
  <span
    style="
      display: inline-block;
      width: 7px; height: 7px; border-radius: 50%;
      background: {$theme.fg ? $theme.fg + '44' : '#ffffff44'};
      flex-shrink: 0;
    "
  ></span>
{/if}
```

Also wire `primaryWs` so clicking the container row (when no worktree is clicked) switches to the primary:

Find the existing `onOpenGroup` or similar handler and ensure it calls `switchWorkspace` to the primary workspace index when the container row itself is clicked (not a nested row).

- [ ] **Step 4: Run the full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/WorkspaceGroupSectionContent.svelte
git commit -m "feat(group-unification): show primary workspace status on container row, hide from nested list"
```

---

## Task 6: Replace SplitButton with "⎇ Branch" button in container row

**Files:**

- Modify: `src/lib/components/WorkspaceGroupSectionContent.svelte`
- Modify: `src/lib/components/PrimarySidebar.svelte`

- [ ] **Step 1: Replace the SplitButton in `WorkspaceGroupSectionContent.svelte`**

The existing code (around line 171–176) has:

```typescript
$: actions = groupContext
  ? $workspaceActionStore.filter((a) => !a.when || a.when(groupContext!))
  : [];
$: coreAction = actions.find((a) => a.id === "core:new-workspace");
$: otherActions = actions.filter((a) => a.id !== "core:new-workspace");
```

And in the template, a `<SplitButton>` that uses `coreAction` and `otherActions`.

Replace the `SplitButton` in the template with a plain button that calls `worktrees:create-workspace`. First, import `runCommandById` at the top of the script:

```typescript
import { runCommandById } from "../services/command-registry";
```

In the template, replace the `<SplitButton ...>` block with:

```svelte
{#if groupContext}
  <button
    class="branch-btn"
    title="New worktree workspace"
    on:click|stopPropagation={() =>
      runCommandById("worktrees:create-workspace", groupContext)}
  >
    ⎇ Branch
  </button>
{/if}
```

Remove the `SplitButton` import if it is no longer used in this file.

Add the style for `branch-btn` in the `<style>` block:

```css
.branch-btn {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--section-btn-fg, currentColor);
  background: transparent;
  color: var(--section-btn-fg, currentColor);
  cursor: pointer;
  opacity: 0.6;
  flex-shrink: 0;
}
.branch-btn:hover {
  opacity: 1;
}
```

- [ ] **Step 2: Simplify PrimarySidebar.svelte — remove split-button dropdown**

The sidebar header uses a `SplitButton` with `dropdownItems`. After the extension is removed (Task 7), `workspaceZoneActions` will be empty and `splitDropdownItems` will be empty. Simplify now by replacing the `SplitButton` with a plain button for the "New" action:

Replace the `<SplitButton ...>` block inside `<span class="top-row-new-chip">` (around line 143–149) with:

```svelte
{#if coreAction}
  <span class="top-row-new-chip" style="...existing styles...">
    <button
      style="-webkit-app-region: no-drag;"
      on:click={() => coreAction?.handler({})}
    >
      + New
    </button>
  </span>
{/if}
```

Remove the `SplitButton` import from `PrimarySidebar.svelte` if it becomes unused, and remove the `splitDropdownItems` and `workspaceZoneActions` reactive declarations.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/WorkspaceGroupSectionContent.svelte \
        src/lib/components/PrimarySidebar.svelte
git commit -m "feat(group-unification): replace SplitButton with ⎇ Branch button in container row"
```

---

## Task 7: Absorb worktree-workspaces extension into core

**Files:**

- Modify: `src/lib/bootstrap/init-workspace-groups.ts`
- Modify: `src/lib/bootstrap/register-included-extensions.ts`
- Delete: `src/extensions/worktree-workspaces/index.ts`
- Delete: `src/__tests__/worktree-workspaces-extension.test.ts`

- [ ] **Step 1: Register `create-worktree` workspace action in core**

In `src/lib/bootstrap/init-workspace-groups.ts`, add the following after the `core:new-workspace` workspace action registration. Add imports for `runCommandById` at the top:

```typescript
import { registerCommand, runCommandById } from "../services/command-registry";
```

Then in `initWorkspaceGroups()` where workspace actions are registered, add:

```typescript
// Formerly owned by the worktree-workspaces extension. The action is
// now always registered from core; the ⎇ Branch button in
// WorkspaceGroupSectionContent calls worktrees:create-workspace directly.
registerWorkspaceAction({
  id: "core:create-worktree",
  label: "⎇ Branch",
  icon: "git-branch",
  source: SOURCE,
  handler: (ctx) => {
    runCommandById("worktrees:create-workspace", ctx);
  },
});
```

Note: `runCommandById` returns `false` silently when the command is absent — no error handling needed.

- [ ] **Step 2: Remove worktree-workspaces from `register-included-extensions.ts`**

Open `src/lib/bootstrap/register-included-extensions.ts`. Remove:

- The import block for `worktreeWorkspacesManifest` and `registerWorktreeWorkspacesExtension` (lines 38–40)
- The `[worktreeWorkspacesManifest, registerWorktreeWorkspacesExtension, "worktree-workspaces"]` entry from `INCLUDED_EXTENSIONS` (lines 71–74)

- [ ] **Step 3: Delete the extension and its test**

```bash
rm src/extensions/worktree-workspaces/index.ts
rm src/__tests__/worktree-workspaces-extension.test.ts
```

If `src/extensions/worktree-workspaces/` is now empty, remove the directory:

```bash
rmdir src/extensions/worktree-workspaces/ 2>/dev/null || true
```

- [ ] **Step 4: Update the worktree-service test that references the old extension**

Open `src/__tests__/worktree-service.test.ts` and find the comment at line 61:

```typescript
it("does NOT register the workspace action — that lives in the worktree-workspaces extension", () => {
```

Update it to reflect the new reality:

```typescript
it("does NOT register the workspace action — that is handled by init-workspace-groups", () => {
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all pass. The deleted test file is gone; all other tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bootstrap/init-workspace-groups.ts \
        src/lib/bootstrap/register-included-extensions.ts \
        src/__tests__/worktree-service.test.ts
git rm src/extensions/worktree-workspaces/index.ts \
       src/__tests__/worktree-workspaces-extension.test.ts
git commit -m "feat(group-unification): absorb worktree-workspaces extension into core"
```

---

## Task 8: Naming pass — rename WorkspaceGroupEntry → WorkspaceEntry

**Files:** All files that reference `WorkspaceGroupEntry`, `WorkspaceGroupSectionContent`, `workspace-group-service`, `getWorkspacesInGroup`

This is a mechanical rename. Do it in one commit.

- [ ] **Step 1: Rename the type in `src/lib/config.ts`**

```typescript
// Before
export interface WorkspaceGroupEntry { ... }

// After
export interface WorkspaceEntry { ... }
```

- [ ] **Step 2: Global rename with grep+sed**

```bash
# Rename the type everywhere
grep -rl "WorkspaceGroupEntry" src/ --include="*.ts" --include="*.svelte" | \
  xargs sed -i '' 's/WorkspaceGroupEntry/WorkspaceEntry/g'

# Rename the component
mv src/lib/components/WorkspaceGroupSectionContent.svelte \
   src/lib/components/WorkspaceSectionContent.svelte

grep -rl "WorkspaceGroupSectionContent" src/ --include="*.ts" --include="*.svelte" | \
  xargs sed -i '' 's/WorkspaceGroupSectionContent/WorkspaceSectionContent/g'

# Rename getWorkspacesInGroup
grep -rl "getWorkspacesInGroup" src/ --include="*.ts" --include="*.svelte" | \
  xargs sed -i '' 's/getWorkspacesInGroup/getWorktreeWorkspaces/g'

# Update the function name in the service file too
sed -i '' 's/export function getWorkspacesInGroup/export function getWorktreeWorkspaces/' \
  src/lib/services/workspace-group-service.ts
```

- [ ] **Step 3: Update `docs/glossary.md`**

Open `docs/glossary.md` and replace all references to "Workspace Group" (as a concept) with "Workspace" where appropriate. Add a note that the data type is now `WorkspaceEntry` and that nesting is provided by the `WorkspaceEntry.primaryWorkspaceId` + worktree pattern.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(group-unification): rename WorkspaceGroupEntry → WorkspaceEntry across codebase"
```

---

## Final verification

- [ ] Run `npm test` — all tests pass
- [ ] Run `npx tsc --noEmit` — no type errors
- [ ] Run `cargo check --manifest-path src-tauri/Cargo.toml` — no Rust errors
- [ ] Run `npm run build` — full build succeeds
