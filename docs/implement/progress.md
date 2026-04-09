# UX Review Implementation — Progress

**Request:** Address all 35 findings from the holistic UX review
**Classification:** Broad / High-complexity
**Base branch:** `jrvs/orchestrator`
**Plan:** `docs/implement/ux-review-plan.md`
**Context docs:** `docs/implement/context-wave2-contracts.md`

## Stories

| ID  | Story                    | Wave | Status               | Branch                                                |
| --- | ------------------------ | ---- | -------------------- | ----------------------------------------------------- |
| S1  | Tab Bar Chrome           | 1    | complete             | s1-tab-bar-chrome (merged)                            |
| S2  | Right Sidebar & Git      | 1    | complete             | s2-right-sidebar-git (merged)                         |
| S3  | Settings Foundation      | 1    | complete             | s3-settings-foundation (merged)                       |
| S4  | Navigation & Breadcrumbs | 2    | complete             | s4-navigation-breadcrumbs (merged, conflict resolved) |
| S5  | Agent Orchestration UX   | 2    | complete             | s5-agent-orchestration-ux (merged)                    |
| S6  | Workspace Lifecycle UI   | 3    | **ready**            | —                                                     |
| S7  | Settings UI              | 3    | **ready** (after S6) | —                                                     |

## Documents Produced

- `docs/implement/ux-review-plan.md` — full plan with acceptance criteria
- `docs/implement/context-wave2-contracts.md` — shared interface contracts for Wave 2
- `docs/implement/progress.md` — this file

## Phase

**Paused after Wave 2.** Waves 1-2 complete (623 tests). Wave 3 (S6, S7) is ready to execute.

Resume with: `/implement:build --resume`

## Wave 1 Integration (581 tests passing)

- S3 merged first (fast-forward), S2 merged second (ort strategy), S1 merged third (ort strategy)
- All tests green after each merge
- S1 deviation: AC8 (empty pane) needs App.svelte wire-up in S6

## Wave 2 Integration (623 tests passing)

- S5 merged first (fast-forward), S4 merged second (conflict in Sidebar.svelte resolved — S4 restructured harness display, S5 changed preset label; took S4 structure with S5 harnessLabel())
- S4 deviation: branched from older HEAD (fce5a55 vs 6b39509); Cmd+Shift+H reassigned from flashFocusedPane to goHome
- S4 deviation: "Jump to Waiting Agent" uses dynamic import fallback until findNextWaitingAgent() is wired (it is — S5 merged first)
- All tests green after merge

## Remaining Work (Wave 3)

### S6: Workspace Lifecycle UI

Wire stash/restore/archive/delete to context menus + keybindings. Add stashed/archived sidebar sections. Close→stash for managed workspaces. 3-option archive dialog. Delete confirmation. Restore with new PTY sessions. Also wire S1's empty pane placeholder in App.svelte.

**Full acceptance criteria:** See `docs/implement/ux-review-plan.md` S6 section.

**Files in scope:** Sidebar.svelte, App.svelte, workspace-actions.ts, stores/project.ts, HomeScreen.svelte, keybindings.ts

### S7: Settings UI

Harness preset CRUD, custom commands CRUD, terminal/shell settings sections, open-in-editor, consistent auto-save, first-run onboarding, wire keybinding settings to handler.

**Full acceptance criteria:** See `docs/implement/ux-review-plan.md` S7 section.

**Files in scope:** SettingsView.svelte, ProjectSettingsView.svelte, HomeScreen.svelte, keybindings.ts
