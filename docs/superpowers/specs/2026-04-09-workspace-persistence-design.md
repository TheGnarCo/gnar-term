# Workspace Persistence

Restore workspaces across app restarts: layout, names, cwds, and active workspace index. Fresh shells on restore (no scrollback or PTY state).

## State File

Path: `~/.config/gnar-term/state.json` (existing `saveState`/`loadState` infrastructure).

New fields:

```json
{
  "workspaces": [
    {
      "name": "Dev",
      "cwd": "/Users/jarvis/Code/gnar-term",
      "layout": {
        "pane": {
          "surfaces": [
            { "type": "terminal", "cwd": "/Users/jarvis/Code/gnar-term" }
          ]
        }
      }
    },
    {
      "name": "Docs",
      "cwd": "~/notes",
      "layout": {
        "direction": "horizontal",
        "split": 0.5,
        "children": [
          { "pane": { "surfaces": [{ "type": "terminal" }] } },
          { "pane": { "surfaces": [{ "type": "terminal" }] } }
        ]
      }
    }
  ],
  "activeWorkspaceIdx": 0
}
```

Each workspace entry is a `WorkspaceDef` (already defined in `config.ts`) with a required `name`.

## What Gets Persisted

- Workspace names and order
- Active workspace index
- Split layout tree (direction, ratio, children)
- Per-surface: type, cwd, title
- Extension surfaces: surfaceTypeId, props

## What Does NOT Persist

- Terminal scrollback and PTY sessions (fresh shells on restore)
- Runtime objects (Terminal, FitAddon, ResizeObserver, etc.)
- Sidebar widths/visibility (separate concern)

## Save Trigger

Debounced save (2 second delay) after any workspace mutation:

- `createWorkspace` / `closeWorkspace`
- `renameWorkspace` / `reorderWorkspaces`
- `splitPane` / `closePane`
- `createSurface` / `closeSurface`

Implementation: a `persistWorkspaces()` function in `workspace-service.ts` that serializes all workspaces via `serializeLayout()` and calls `saveState({ workspaces, activeWorkspaceIdx })`. A `schedulePersist()` wrapper debounces at 2 seconds.

## Restore on Launch

In `App.svelte` `onMount`, before the existing workspace creation logic:

1. Call `loadState()`
2. If `state.workspaces` is a non-empty array:
   - For each entry, call `createWorkspaceFromDef(entry)`
   - Set `activeWorkspaceIdx` to `state.activeWorkspaceIdx` (clamped to bounds)
   - Skip `autoload` and default workspace creation
3. If no saved state: fall back to existing behavior (`autoload` / CLI args / default)

## Files to Modify

| File                                    | Change                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/services/workspace-service.ts` | Add `persistWorkspaces()` and `schedulePersist()`. Call `schedulePersist()` from `createWorkspace`, `closeWorkspace`, `renameWorkspace`, `reorderWorkspaces`. |
| `src/lib/services/pane-service.ts`      | Call `schedulePersist()` from `splitPane`, `closePane`.                                                                                                       |
| `src/lib/services/surface-service.ts`   | Call `schedulePersist()` from surface create/close.                                                                                                           |
| `src/App.svelte`                        | Add restore logic in `onMount` before existing workspace init.                                                                                                |
| `src/lib/config.ts`                     | Add `workspaces` and `activeWorkspaceIdx` to `AppState` type.                                                                                                 |

## Testing

- Unit test: `persistWorkspaces()` serializes workspaces and calls `saveState` with correct shape
- Unit test: restore logic skips `autoload` when saved state exists
- Unit test: restore falls back to defaults when no saved state
- Unit test: debounce coalesces rapid mutations into one save
