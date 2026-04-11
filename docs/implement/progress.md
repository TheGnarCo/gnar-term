# Workspace Action Registry — Progress

**Branch:** `jrvs/orchestrator-core`
**Spec:** `docs/superpowers/specs/2026-04-10-workspace-action-registry-design.md`

## S1: Core Infrastructure — COMPLETE

| Item                                   | Status   | Commit    |
| -------------------------------------- | -------- | --------- |
| tauri-plugin-dialog                    | complete | `ebf9b4f` |
| workspace-action-registry.ts           | complete | `ebf9b4f` |
| API types (api.ts, extension-types.ts) | complete | `ebf9b4f` |
| extension-loader (new methods)         | complete | `ebf9b4f` |

## S2: PrimarySidebar + Tooltips — IN PROGRESS

Render workspace action buttons from store in sidebar header. Add tooltips to all icon buttons.

## S3: Managed Workspaces Rework — IN PROGRESS

Remove sidebar section, register workspace action, use pickDirectory.

## S4: Project Scope Rework — IN PROGRESS

Dynamic per-project sections, workspace action buttons, remove floating workspaces.

## S5: Test Updates — IN PROGRESS

Update tests for reworked extensions.

## Next

Resume with `/implement:build --resume` if context runs out.
