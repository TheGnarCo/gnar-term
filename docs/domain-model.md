# GnarTerm Domain Model

## Hierarchy

```
Project (registered git repo or local directory)
  Workspace (a tab in the top-level workspace bar)
    Pane (a rectangular region in the split tree)
      Surface (content behind a pane tab: terminal, preview, diff, etc.)
```

Additionally, **floating workspaces** exist outside any project.

## Workspace Types

| Type     | Value        | Description                                                                                    |
| -------- | ------------ | ---------------------------------------------------------------------------------------------- |
| Terminal | `"terminal"` | Ad-hoc shell session. CWD is unrestricted. No git features.                                    |
| Managed  | `"managed"`  | Backed by a git worktree. CWD locked to worktree root. Right sidebar shows diff/files/commits. |

Historical values `"scratchpad"` and `"worktree"` are auto-migrated on load.

## Workspace Status

| Status       | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| `"active"`   | Open in the UI, restored on startup                      |
| `"stashed"`  | Closed but remembered. Not restored on startup.          |
| `"archived"` | Worktree removed from disk. Branch may have been pushed. |

## Floating Workspaces

Workspaces not attached to any project. Always type `"terminal"`.
Persisted in `state.floatingWorkspaces[]` (separate from project workspaces).
Appear at the top of the sidebar at project level.

## Surface Types

| Kind            | Description                                              |
| --------------- | -------------------------------------------------------- |
| `terminal`      | Interactive PTY shell                                    |
| `harness`       | AI CLI tool (e.g. Claude Code) in its own PTY            |
| `preview`       | Read-only file viewer (markdown, image, JSON, CSV, etc.) |
| `diff`          | Git diff viewer                                          |
| `filebrowser`   | Tracked file listing                                     |
| `commithistory` | Commit log viewer                                        |

"Surface" is the data model; "Tab" is the UI element that selects a surface.
See the glossary in `src/lib/types.ts` for the full explanation.

## Persistence

| File                            | Purpose                                        | Editable?        |
| ------------------------------- | ---------------------------------------------- | ---------------- |
| `~/.config/gnar/state.json`     | Projects, workspaces, floating workspaces      | No (app-managed) |
| `~/.config/gnar/settings.json`  | User preferences, harness presets, keybindings | Yes              |
| `<project>/.gnar/settings.json` | Per-project setting overrides                  | Yes              |

`state.json` is the source of truth for all structural data. Svelte stores
mirror it at runtime but never lead mutations.
