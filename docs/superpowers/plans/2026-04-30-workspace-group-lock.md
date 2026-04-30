# Workspace Group Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing workspace lock UX to workspace groups — locked groups cannot be drag-reordered or deleted/archived, but their nested workspaces remain freely manageable.

**Architecture:** Add `locked?: boolean` to `WorkspaceGroupEntry`, add a `toggleWorkspaceGroupLock()` service function and a lock gate on `deleteWorkspaceGroup()`, thread the lock state through `ContainerRow` → `DragGrip` for the visual chip, update the group banner context menu, and gate the root-row drag in `WorkspaceListBlock`.

**Tech Stack:** TypeScript, Svelte 5, Vitest

---

## File Map

| File                                                     | Change                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/config.ts`                                      | Add `locked?: boolean` to `WorkspaceGroupEntry`                             |
| `src/lib/services/workspace-group-service.ts`            | Add `toggleWorkspaceGroupLock()`, add lock gate to `deleteWorkspaceGroup()` |
| `src/lib/components/ContainerRow.svelte`                 | Add `locked` prop, thread to `DragGrip`                                     |
| `src/lib/components/WorkspaceGroupSectionContent.svelte` | Compute `isGroupLocked`, pass to `ContainerRow`, update context menu        |
| `src/lib/components/WorkspaceListBlock.svelte`           | Gate root-row drag for locked groups                                        |
| `src/__tests__/workspace-group-lock.test.ts`             | New test file: toggle + delete-gate tests                                   |
| `src/__tests__/reorder-suppression.test.ts`              | Add assertion: locked group blocks drag in `WorkspaceListBlock`             |

---

## Task 1: Add `locked` field to `WorkspaceGroupEntry`

**Files:**

- Modify: `src/lib/config.ts:142-159`

- [ ] **Step 1: Add the field**

In `src/lib/config.ts`, after `dashboardWorkspaceId?: string;` (line 158), add:

```typescript
export interface WorkspaceGroupEntry {
  id: string;
  name: string;
  /** Root CWD — auto-adoption uses this as a longest-prefix ancestor match. */
  path: string;
  color: string;
  /** Ids of workspaces currently claimed by this group. */
  workspaceIds: string[];
  /** True when `path` is the root of a git repo. Used by gates (e.g. worktree actions). */
  isGit: boolean;
  createdAt: string;
  /**
   * Id of the Group Dashboard workspace hosting this group's markdown
   * Live Preview. Eagerly created alongside the group. Resolved from
   * the workspaces store by consumers.
   */
  dashboardWorkspaceId?: string;
  /** When true, the group cannot be drag-reordered or deleted/archived. */
  locked?: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: no new type errors (field is optional so existing group objects remain valid without it).

- [ ] **Step 3: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat: add locked field to WorkspaceGroupEntry type"
```

---

## Task 2: Service layer — toggle function + delete gate

**Files:**

- Modify: `src/lib/services/workspace-group-service.ts:43-67`

- [ ] **Step 1: Write failing tests first**

Create `src/__tests__/workspace-group-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/stores/root-row-order", () => ({
  appendRootRow: vi.fn(),
  removeRootRow: vi.fn(),
}));
vi.mock("../lib/services/claimed-workspace-registry", () => ({
  claimWorkspace: vi.fn(),
  unclaimWorkspace: vi.fn(),
}));
vi.mock("../lib/services/group-git-dirty-store", () => ({
  releaseGroupDirtyStore: vi.fn(),
}));
vi.mock("../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: vi.fn(),
  closeWorkspace: vi.fn(),
}));
vi.mock("../lib/services/event-bus", () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import {
  setWorkspaceGroups,
  getWorkspaceGroups,
} from "../lib/stores/workspace-groups";
import {
  toggleWorkspaceGroupLock,
  deleteWorkspaceGroup,
} from "../lib/services/workspace-group-service";
import { removeRootRow } from "../lib/stores/root-row-order";
import type { WorkspaceGroupEntry } from "../lib/config";

function makeGroup(
  overrides: Partial<WorkspaceGroupEntry> = {},
): WorkspaceGroupEntry {
  return {
    id: "g1",
    name: "Test Group",
    path: "/tmp/g1",
    color: "purple",
    workspaceIds: [],
    isGit: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("toggleWorkspaceGroupLock", () => {
  beforeEach(() => {
    setWorkspaceGroups([]);
  });

  it("sets locked to true on first toggle", () => {
    setWorkspaceGroups([makeGroup({ id: "g1" })]);
    toggleWorkspaceGroupLock("g1");
    expect(getWorkspaceGroups()[0].locked).toBe(true);
  });

  it("clears locked back to false on second toggle", () => {
    setWorkspaceGroups([makeGroup({ id: "g1", locked: true })]);
    toggleWorkspaceGroupLock("g1");
    expect(getWorkspaceGroups()[0].locked).toBe(false);
  });

  it("preserves other fields when toggling", () => {
    setWorkspaceGroups([
      makeGroup({ id: "g1", name: "Keep Me", color: "blue" }),
    ]);
    toggleWorkspaceGroupLock("g1");
    const g = getWorkspaceGroups()[0];
    expect(g.locked).toBe(true);
    expect(g.name).toBe("Keep Me");
    expect(g.color).toBe("blue");
  });

  it("only mutates the matching group", () => {
    setWorkspaceGroups([makeGroup({ id: "g1" }), makeGroup({ id: "g2" })]);
    toggleWorkspaceGroupLock("g2");
    expect(getWorkspaceGroups()[0].locked).toBeUndefined();
    expect(getWorkspaceGroups()[1].locked).toBe(true);
  });

  it("is a no-op for an unknown group id", () => {
    const g = makeGroup({ id: "g1" });
    setWorkspaceGroups([g]);
    toggleWorkspaceGroupLock("does-not-exist");
    expect(getWorkspaceGroups()[0]).toEqual(g);
  });
});

describe("deleteWorkspaceGroup — lock gate", () => {
  beforeEach(() => {
    setWorkspaceGroups([]);
    vi.mocked(removeRootRow).mockClear();
  });

  it("deletes an unlocked group normally", () => {
    setWorkspaceGroups([makeGroup({ id: "g1" })]);
    deleteWorkspaceGroup("g1");
    expect(getWorkspaceGroups()).toHaveLength(0);
    expect(removeRootRow).toHaveBeenCalledWith({
      kind: "workspace-group",
      id: "g1",
    });
  });

  it("is a no-op when group is locked", () => {
    setWorkspaceGroups([makeGroup({ id: "g1", locked: true })]);
    deleteWorkspaceGroup("g1");
    expect(getWorkspaceGroups()).toHaveLength(1);
    expect(removeRootRow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose workspace-group-lock 2>&1 | tail -20
```

Expected: `toggleWorkspaceGroupLock is not a function` or similar — confirms the tests target the right symbols.

- [ ] **Step 3: Implement `toggleWorkspaceGroupLock` and lock gate in `deleteWorkspaceGroup`**

In `src/lib/services/workspace-group-service.ts`, add after `updateWorkspaceGroup` (around line 58) and update `deleteWorkspaceGroup`:

```typescript
/**
 * Toggle the `locked` flag on a workspace group. Locked groups have
 * their drag-reorder, delete, and archive affordances suppressed.
 * No-op if no group with the given id exists.
 */
export function toggleWorkspaceGroupLock(id: string): void {
  const groups = getWorkspaceGroups();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx === -1) return;
  const next = groups.map((g) =>
    g.id === id ? { ...g, locked: !g.locked } : g,
  );
  setWorkspaceGroups(next);
  emitStateChanged({ groupId: id });
}

export function deleteWorkspaceGroup(id: string): void {
  const group = getWorkspaceGroup(id);
  if (group?.locked) return;
  const next = getWorkspaceGroups().filter((g) => g.id !== id);
  setWorkspaceGroups(next);
  removeRootRow({ kind: "workspace-group", id });
  if (group) releaseGroupDirtyStore(group.path);
  emitStateChanged({ groupId: id });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose workspace-group-lock 2>&1 | tail -20
```

Expected: all 7 tests green.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/workspace-group-service.ts src/__tests__/workspace-group-lock.test.ts
git commit -m "feat: add toggleWorkspaceGroupLock and gate deleteWorkspaceGroup on locked flag"
```

---

## Task 3: Thread `locked` through `ContainerRow` → `DragGrip`

**Files:**

- Modify: `src/lib/components/ContainerRow.svelte:28-131` (props block and DragGrip usage)

`ContainerRow` renders a `DragGrip` in its root variant (around line 239). `DragGrip` already has a `locked` prop that shows the lock chip and sets `cursor: not-allowed`. We need to add a `locked` prop to `ContainerRow` and thread it through.

- [ ] **Step 1: Add `locked` prop and thread to `DragGrip`**

In `src/lib/components/ContainerRow.svelte`:

After `export let onClose: (() => void) | undefined = undefined;` (around line 52), add:

```svelte
/** When true, shows a lock chip on the grip instead of the close button. */
export let locked: boolean = false;
```

Then find the `DragGrip` usage in the root variant (around line 239):

```svelte
<DragGrip
  theme={$theme}
  visible={rowHovered && $reorderContext === null}
  railColor={color}
  railOpacity={1}
  alwaysShowDots={true}
  fadeRight={!rowHovered}
  {onClose}
  closeTooltip="Delete Workspace Group"
/>
```

Change it to:

```svelte
<DragGrip
  theme={$theme}
  visible={rowHovered && $reorderContext === null}
  railColor={color}
  railOpacity={1}
  alwaysShowDots={true}
  fadeRight={!rowHovered}
  onClose={locked ? undefined : onClose}
  closeTooltip="Delete Workspace Group"
  {locked}
/>
```

(Passing `onClose={locked ? undefined : onClose}` ensures the × button is also suppressed when locked, consistent with how `DragGrip` works — `showClose` requires `onClose != null`.)

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | head -30
```

Expected: clean.

- [ ] **Step 3: Run tests**

```bash
npm test 2>&1 | tail -10
```

Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ContainerRow.svelte
git commit -m "feat: thread locked prop through ContainerRow to DragGrip"
```

---

## Task 4: Wire lock state in `WorkspaceGroupSectionContent` and update context menu

**Files:**

- Modify: `src/lib/components/WorkspaceGroupSectionContent.svelte`

This is where the group's reactive state lives (`group` variable), the context menu is built, and `ContainerRow` is mounted.

- [ ] **Step 1: Import `toggleWorkspaceGroupLock`**

In the import block for workspace-group-service (around line 22-28), add `toggleWorkspaceGroupLock`:

```typescript
import {
  deleteWorkspaceGroup,
  updateWorkspaceGroup,
  closeWorkspacesInGroup,
  groupDashboardPath,
  openGroupDashboard,
  toggleWorkspaceGroupLock,
  WORKSPACE_GROUP_STATE_CHANGED,
} from "../services/workspace-group-service";
```

- [ ] **Step 2: Compute `isGroupLocked` reactive variable**

After the existing reactive declarations block (after the `$: groupContext = ...` block, around line 160), add:

```typescript
$: isGroupLocked = group?.locked === true;
```

- [ ] **Step 3: Update `handleBannerContextMenu` to add lock toggle and disable archive/delete**

Replace the context menu builder in `handleBannerContextMenu` (lines 257-317). The key changes are:

1. Add "Lock/Unlock Workspace Group" item (after the separator before Archive)
2. Add `disabled: isGroupLocked` to Archive Group
3. Add `disabled: isGroupLocked` to Delete Workspace Group

The full updated function:

```typescript
function handleBannerContextMenu(e: MouseEvent) {
  if (!group) return;
  e.preventDefault();
  e.stopPropagation();
  const items: Array<{
    label: string;
    action: () => void;
    shortcut?: string;
    separator?: boolean;
    danger?: boolean;
    disabled?: boolean;
  }> = [
    {
      label: "Rename Workspace Group",
      action: () => {
        void handleRenameGroup();
      },
    },
    {
      label: "Open Dashboard",
      action: () => {
        if (group) void openGroupDashboard(group);
      },
    },
  ];
  if (coreAction && groupContext) {
    items.push({
      label: "New Workspace",
      action: () => coreAction!.handler(groupContext!),
    });
  }
  for (const a of otherActions) {
    items.push({
      label: a.label,
      action: () => void a.handler(groupContext!),
    });
  }
  if (addableContributions.length > 0) {
    items.push({ label: "", action: () => {}, separator: true });
    for (const c of addableContributions) {
      items.push({
        label: c.actionLabel,
        action: () => void handleAddDashboardContribution(c),
      });
    }
  }
  items.push({ label: "", action: () => {}, separator: true });
  items.push({
    label: isGroupLocked ? "Unlock Workspace Group" : "Lock Workspace Group",
    action: () => {
      if (group) toggleWorkspaceGroupLock(group.id);
    },
  });
  items.push({
    label: "Archive Group",
    disabled: isGroupLocked,
    action: () => {
      if (group) void archiveGroup(group.id);
    },
  });
  items.push({
    label: "Delete Workspace Group",
    danger: true,
    disabled: isGroupLocked,
    action: () => {
      void handleDeleteGroup();
    },
  });
  contextMenu.set({ x: e.clientX, y: e.clientY, items });
}
```

- [ ] **Step 4: Pass `locked` to `ContainerRow`**

Find the `<ContainerRow` mount (around line 436) and add `locked={isGroupLocked}`:

```svelte
<ContainerRow
  color={groupHex}
  {onGripMouseDown}
  onBannerContextMenu={handleBannerContextMenu}
  onBannerClick={handleBannerClick}
  onClose={handleDeleteGroup}
  {filterIds}
  {hasActiveChild}
  dashboardHintFor={hintForGroupDashboardHost}
  scopeId={group.id}
  {containerBlockId}
  containerLabel={group.name}
  testId={group.id}
  workspaceListViewComponent={WorkspaceListView}
  locked={isGroupLocked}
>
```

- [ ] **Step 5: Verify build and tests**

```bash
npm run build 2>&1 | head -30 && npm test 2>&1 | tail -10
```

Expected: clean build, no failing tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/WorkspaceGroupSectionContent.svelte
git commit -m "feat: wire group lock state to ContainerRow and context menu"
```

---

## Task 5: Gate root-row drag for locked groups in `WorkspaceListBlock`

**Files:**

- Modify: `src/lib/components/WorkspaceListBlock.svelte:30-66` (imports) and `316-327` (startRootRowDrag)

Currently `startRootRowDrag` only gates on workspace kind. We need to add a group-kind check.

- [ ] **Step 1: Add `getWorkspaceGroup` import**

In `WorkspaceListBlock.svelte`, the existing stores/services import block (around line 30-66). Add to the workspace-groups import:

After the existing imports, add:

```typescript
import { getWorkspaceGroup } from "../stores/workspace-groups";
```

- [ ] **Step 2: Update `startRootRowDrag` to gate locked groups**

Find `startRootRowDrag` (lines 316-327):

```typescript
function startRootRowDrag(e: MouseEvent, rowIdx: number) {
  // Refuse to start a drag when the source row is a locked workspace.
  // canStart on createDragReorder is invoked before sourceIdx is
  // populated, so we gate at the call site where we already know which
  // row the user pressed.
  const srcRow = $rootRowOrder[rowIdx];
  if (srcRow?.kind === "workspace") {
    const ws = $workspaces.find((w) => w.id === srcRow.id);
    if (ws && wsMeta(ws).locked === true) return;
  }
  rootDrag.start(e, rowIdx);
}
```

Replace with:

```typescript
function startRootRowDrag(e: MouseEvent, rowIdx: number) {
  const srcRow = $rootRowOrder[rowIdx];
  if (srcRow?.kind === "workspace") {
    const ws = $workspaces.find((w) => w.id === srcRow.id);
    if (ws && wsMeta(ws).locked === true) return;
  } else if (srcRow?.kind === "workspace-group") {
    const group = getWorkspaceGroup(srcRow.id);
    if (group?.locked === true) return;
  }
  rootDrag.start(e, rowIdx);
}
```

- [ ] **Step 3: Add drag-gate assertion to `reorder-suppression.test.ts`**

In `src/__tests__/reorder-suppression.test.ts`, add at the end of the `"canStart gating"` describe block (after line 63):

```typescript
it("WorkspaceListBlock gates startRootRowDrag for locked workspace-groups", () => {
  // The guard must check the workspace-group kind and bail when locked.
  expect(WORKSPACE_LIST_BLOCK).toContain('srcRow?.kind === "workspace-group"');
  expect(WORKSPACE_LIST_BLOCK).toContain("group?.locked === true");
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --reporter=verbose reorder-suppression 2>&1 | tail -20
```

Expected: new test passes alongside existing ones.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/WorkspaceListBlock.svelte src/__tests__/reorder-suppression.test.ts
git commit -m "feat: gate root-row drag for locked workspace groups"
```

---

## Self-Review

### Spec coverage

| Requirement                                                | Task                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| Lock/Unlock toggle in group context menu                   | Task 4, Step 3                                                  |
| Locked group cannot be drag-reordered                      | Task 5                                                          |
| Locked group shows visual lock chip on grip                | Task 3 + Task 4 (ContainerRow threads `locked` to DragGrip)     |
| Delete disabled in context menu when locked                | Task 4, Step 3                                                  |
| Archive disabled in context menu when locked               | Task 4, Step 3                                                  |
| `deleteWorkspaceGroup()` no-ops when locked (service gate) | Task 2, Step 3                                                  |
| Nested workspaces freely manageable (no change)            | N/A — no code changes to WorkspaceListView or nested reorder    |
| Lock persists across restarts                              | Serialized via `setWorkspaceGroups` → existing persistence path |
| Tests for toggle + delete gate                             | Task 2                                                          |
| Build must succeed                                         | Verified in every task                                          |

### Placeholder scan

No TBD/TODO/placeholder patterns — every step contains actual code.

### Type consistency

- `WorkspaceGroupEntry.locked?: boolean` defined in Task 1, used in Tasks 2, 4, 5 — consistent.
- `toggleWorkspaceGroupLock(id: string): void` defined in Task 2, imported in Task 4 — consistent.
- `ContainerRow` `locked: boolean = false` added in Task 3, set in Task 4 as `locked={isGroupLocked}` — consistent.
- `getWorkspaceGroup` already exported from `../stores/workspace-groups` — verified in Task 5 import.

### Gap: archive service

`archiveGroup()` in `archive-service.ts` bypasses `deleteWorkspaceGroup` entirely (it calls `setWorkspaceGroups().filter(...)` directly). The UI gate (disabled menu item) is the primary enforcement for archive. This is acceptable and consistent with workspace behavior (archive is also only UI-gated for locked workspaces). The service-layer gate on `deleteWorkspaceGroup` covers the explicit-delete path. If a future hardening pass wants to add a service-layer archive gate, add a `if (group?.locked) return false;` check at the top of `archiveGroup` in `src/lib/services/archive-service.ts`.
