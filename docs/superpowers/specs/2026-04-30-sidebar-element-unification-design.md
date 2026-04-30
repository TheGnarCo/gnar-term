# Unified Primary Sidebar Element Design

## Problem

The gnar-term sidebar has three types of "primary" elements, each with its own rendering and logic:

1. **Workspace Rows** (`WorkspaceItem.svelte`) — workspace entries in the root or nested list
2. **Group Banners** (`ContainerRow.svelte`) — group header rows
3. **Dashboard Tiles** (`WorkspaceSectionContent.svelte`) — dashboard workspace entries

Each has duplicated/slightly-different:

- Close buttons (styling, positioning, hover states)
- Drag grip handling
- Lock buttons
- Rail colors and status indicators
- Context menu logic
- Name truncation and overflow handling

**Impact**: Style drift, positioning inconsistencies (like the Agentic dashboard X button issue), and maintenance burden.

## Vision

Create a unified **`PrimarySidebarElement`** component that encapsulates the chrome (drag grip, close button, lock button, name label) and layout constraints of any primary sidebar entry. Components render the content (icon, status, etc.) and provide callbacks for interactions.

```
PrimarySidebarElement (composition container)
  ├─ DragGrip (left rail)
  ├─ Content Slot (flexible middle)
  └─ ControlsRow (right-side buttons: lock, close)
```

## Scope

### Phase 1: Unified Container Component

**File**: `src/lib/components/PrimarySidebarElement.svelte`

**Props**:

- `kind`: "workspace" | "group" | "dashboard" — determines styling/sizing
- `name`: string — the label (used for truncation, context)
- `isActive`: boolean — highlights the entry
- `isLocked`: boolean — shows lock instead of close
- `isDragging`: boolean — applies drag state styling
- `canDrag`: boolean — enables/disables drag grip
- `canClose`: boolean — shows close button
- `onGripMouseDown`: (e: MouseEvent) => void
- `onClose`: () => void
- `onContextMenu`: (e: MouseEvent) => void
- `color`: string — rail color (e.g., group hex, workspace accentColor)
- `hasActiveChild`: boolean — for groups, shows if any child is active

**Slots**:

- `icon` — icon/indicator (left of name or in place of name)
- `content` — flexible content area (group dashboard tiles, worktree list, etc.)
- `status` — optional status indicator (agent badge, dirty indicator)

### Phase 2: Migrate WorkspaceItem

**Current**: Standalone component with embedded close button, rails, styling

**Changes**:

- Extract `name`, `isActive`, `isLocked`, `color` props
- Move close/lock button logic into `PrimarySidebarElement`
- Keep terminal/surface-specific logic (agent detection, subtitle components)
- Use `<PrimarySidebarElement>` as wrapper

**Result**: WorkspaceItem becomes a thin adapter focused on workspace-specific rendering

### Phase 3: Migrate ContainerRow (Group Banners)

**Current**: Standalone container with `DragGrip`, lock/close buttons, nested list

**Changes**:

- Extract group layout into flex slots
- Move close/lock/drag logic to `PrimarySidebarElement`
- Keep nested-list rendering (`WorkspaceListView`) as slot content

**Result**: ContainerRow simplifies to group-specific banner + nested layout management

### Phase 4: Migrate Dashboard Tiles (WorkspaceSectionContent)

**Current**: Dashboard tile buttons with overlay close buttons

**Changes**:

- Replace inline tile loop with `PrimarySidebarElement` instances
- Use 30px tile styling via `kind="dashboard"` variant
- Keep dashboard-specific icon + status rendering

**Result**: No close button positioning bugs; consistent sizing and hover behavior

## Design Details

### Sizing & Layout

```
┌─ kind="workspace" ─────────────────────┐  height: 32px
│ [grip] [icon] [label] [status] [close] │
└────────────────────────────────────────┘

┌─ kind="group" ─────────────────────────┐  height: 32px
│ [grip] [icon] [name] [lock|close]      │
│   ├─ [nested workspaces]               │
│   └─ [dashboard tiles]                 │
└────────────────────────────────────────┘

┌─ kind="dashboard" ──────────────────┐  height: 30px
│ [icon] [status] [close]             │  (no grip, flex layout)
└─────────────────────────────────────┘
```

### Close Button Positioning

**All kinds**: `position: absolute; top: 50%; right: 6px; transform: translateY(-50%);`  
**Size**: 14px × 14px  
**Border**: 1px solid, colored on hover  
**Color**: `fgDim` default → `danger` on hover

**Lock Button** (workspace-group only):  
Same positioning as close button; only one shows at a time

### DragGrip Integration

- Owned by `PrimarySidebarElement`
- Only renders when `canDrag=true`
- 14px width, fade-right gradient
- No close/lock buttons (those are in the right controls row)

### Hover State Management

- Single `isHovered` state in `PrimarySidebarElement`
- All child controls (close, lock, shortcuts) share this state
- Drives opacity, visibility, color transitions

## Implementation Sequence

1. **Create `PrimarySidebarElement`** (standalone, no migrations yet)
   - Test with static props to verify layout/sizing
   - Ensure close, lock, drag affordances work in isolation

2. **Migrate WorkspaceItem** (Phase 2)
   - Wrap with `<PrimarySidebarElement>`
   - Verify workspace rows still work; test drag, close, lock

3. **Migrate ContainerRow** (Phase 3)
   - Wrap group banner with `<PrimarySidebarElement>`
   - Keep nested list rendering; test group drag, nested drag, collapse

4. **Migrate Dashboard Tiles** (Phase 4)
   - Replace tile loop with `<PrimarySidebarElement>` instances
   - Verify dashboard tiles size, close, styling

5. **Cleanup**
   - Remove duplicate styling from `DragGrip` (close/lock logic now in wrapper)
   - Consolidate color and sizing constants

## Benefits

✅ **Single source of truth** for sidebar element layout and interaction  
✅ **Eliminates drift** — close buttons, drag behavior, styling all consistent  
✅ **Easier testing** — element can be tested in isolation with different `kind` values  
✅ **Extensibility** — new sidebar element types (e.g., pseudo-dashboards, extensions) can reuse the same component  
✅ **Maintenance** — future changes to close button position, size, or color apply everywhere at once  
✅ **Accessibility** — unified ARIA labeling, keyboard handling, focus management

## Risk & Mitigations

| Risk                           | Mitigation                                      |
| ------------------------------ | ----------------------------------------------- |
| Large refactor → test failures | Migrate in phases; test each phase before next  |
| Subtle layout regressions      | Side-by-side comparison before/after each phase |
| Performance (extra wrapping)   | Use slots (zero-cost abstraction in Svelte)     |
| Extensions that style inline   | Document the new structure; provide CSS hooks   |

## Timeline

- **Phase 1** (2-3 hours): Create `PrimarySidebarElement`, test layout
- **Phase 2** (2-3 hours): Migrate WorkspaceItem, test interactions
- **Phase 3** (2-3 hours): Migrate ContainerRow, test group behavior
- **Phase 4** (1-2 hours): Migrate dashboard tiles, cleanup
- **Total**: ~8-11 hours over 2-3 days, split across focused sessions

## Commit Strategy

```
1. feat: create PrimarySidebarElement unified component
2. refactor(workspace-item): use PrimarySidebarElement wrapper
3. refactor(container-row): use PrimarySidebarElement for group banner
4. refactor(dashboard-tiles): use PrimarySidebarElement
5. cleanup: remove duplicate close/lock logic from DragGrip
```

---

## Questions for Approval

1. **Timing**: Should this be part of the current group-unification branch, or deferred to a follow-up?
2. **Backwards compat**: Are there extension developers styling inline that we need to warn?
3. **Accessibility priorities**: Any specific ARIA requirements or keyboard shortcuts to ensure during migration?
