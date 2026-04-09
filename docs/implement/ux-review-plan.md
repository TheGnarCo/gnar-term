# UX Review Implementation Plan

**Request:** Address all 35 findings from the holistic UX review
**Classification:** Broad / High-complexity
**Base branch:** `jrvs/orchestrator` (HEAD: `fce5a55`)
**Strategy:** Wave-based parallel execution (3 waves, 7 stories)

---

## Wave 1 — Independent Foundations (parallel)

### S1: Tab Bar Chrome

**Findings addressed:** #6 (harness/terminal separation), #7 (focused pane indicator),
#13 (harness tab titles), #16 (platform shortcuts), #18 (close pane confirmation),
#21 (active tab styling), #22 (tab overflow), #26 (empty pane placeholder)

**Files in scope:**

- `src/lib/components/TabBar.svelte`
- `src/lib/components/Tab.svelte`
- `src/lib/components/PaneView.svelte`
- `src/lib/components/SplitNodeView.svelte`
- `src/lib/terminal-service.ts` (isMac helper import only)
- Tests: `src/tests/tab-bar.test.ts`, `src/tests/pane-view.test.ts`

**Files out of scope:** App.svelte, Sidebar.svelte, settings.ts, keybindings.ts

**TDD mode:** verify (UI components)

**Acceptance criteria:**

1. TabBar partitions surfaces into harness-kind (left) and terminal-kind (right) groups with a visible divider element between them
2. Harness tabs display the preset name from `HarnessPreset.name` instead of generic "Harness"
3. Active tab has a `border-bottom: 2px solid` accent color indicator
4. Active pane in multi-pane layouts has a persistent accent-colored top border on its tab bar
5. Tab overflow shows left/right scroll arrow buttons when tabs exceed container width
6. Context menu shortcut labels and tooltip strings use platform-aware formatting (Cmd on macOS, Ctrl on Linux/Windows) via `isMac` detection
7. Closing a pane that contains >1 surface or any active harness surface shows a confirmation dialog
8. When the last surface in a pane is closed, show a placeholder with "New Terminal" and "New Harness" buttons instead of immediately collapsing
9. Split divider supports double-click to reset ratio to 0.5
10. All existing tab bar tests pass; new tests cover divider rendering, overflow arrows, platform shortcuts, close confirmation, and empty pane placeholder

---

### S2: Right Sidebar & Git

**Findings addressed:** #12 (right sidebar incomplete — commits tab, click-to-diff,
staged/unstaged, cache refresh), #17 (git pull, push/pull in sidebar), #29 (branch validation)

**Files in scope:**

- `src/lib/components/RightSidebar.svelte`
- `src/lib/components/CommitHistoryView.svelte`
- `src/lib/components/DiffView.svelte`
- `src/lib/components/NewWorkspaceDialog.svelte`
- `src/lib/right-sidebar-data.ts`
- `src/lib/git.ts`
- Tests: `src/tests/right-sidebar.test.ts`, `src/tests/git.test.ts`, `src/tests/new-workspace-dialog.test.ts`

**Files out of scope:** Sidebar.svelte, App.svelte, settings.ts

**TDD mode:** default for git.ts logic, verify for UI components

**Acceptance criteria:**

1. Right sidebar has three tabs: "Changes", "Files", "Commits" (CommitHistoryView mounted as third tab)
2. Clicking a changed file in the Changes tab opens a diff for that specific file
3. Changes tab groups files into "Staged" and "Unstaged" sections based on index vs work-tree status
4. `git.ts` exports a `gitPull(repoPath)` function that runs `git pull --rebase`
5. Right sidebar header shows quick action buttons for Push, Pull, and Fetch
6. Right sidebar data refreshes every 10 seconds while visible (polling interval)
7. Sidebar header shows "N ahead / M behind" indicator using `git rev-list --left-right --count`
8. NewWorkspaceDialog validates branch name against existing branches list and shows inline error for duplicates
9. NewWorkspaceDialog validates branch name format against git naming rules (no spaces, `..`, `~`, `^`, `:`)
10. All existing tests pass; new tests cover commits tab rendering, staged/unstaged grouping, gitPull, refresh polling, ahead/behind display, and branch validation

---

### S3: Settings Foundation

**Findings addressed:** Missing settings must-haves (terminal.scrollback, cursorStyle,
cursorBlink, shell.path, shell.args, accessibility.reducedMotion, harness.notifyOnWaiting)

**Files in scope:**

- `src/lib/settings.ts` (Settings interface + DEFAULT_SETTINGS)
- `src/lib/types.ts` (no changes expected, but may need TerminalSettings sub-interface)
- `src/lib/terminal-service.ts` (createBaseTerminal reads from settings instead of hardcoding)
- `src-tauri/src/pty.rs` (accept optional shell path + args in spawn_pty)
- `src-tauri/src/lib.rs` (update spawn_pty command signature)
- Tests: `src/tests/settings.test.ts`, `src/tests/terminal-service.test.ts`, `src-tauri/src/tests/` (Rust tests)

**Files out of scope:** SettingsView.svelte (that's S7), all .svelte components

**TDD mode:** default (logic + Rust backend)

**Acceptance criteria:**

1. `Settings` interface has a `terminal` sub-object with fields: `scrollback: number`, `cursorStyle: "block" | "bar" | "underline"`, `cursorBlink: boolean`
2. `Settings` interface has a `shell` sub-object with fields: `path: string | null`, `args: string[]`
3. `Settings` interface has an `accessibility` sub-object with field: `reducedMotion: boolean`
4. `Settings` interface has `harness.notifyOnWaiting: boolean` (added to a `harness` sub-object or as a top-level field — use sub-object for consistency)
5. `DEFAULT_SETTINGS` provides sensible defaults: `{ terminal: { scrollback: 5000, cursorStyle: "block", cursorBlink: true }, shell: { path: null, args: [] }, accessibility: { reducedMotion: false }, harness: { notifyOnWaiting: true } }`
6. `createBaseTerminal()` reads `scrollback`, `cursorStyle`, `cursorBlink` from `getSettings().terminal` instead of hardcoded values
7. Rust `spawn_pty` command accepts optional `shell_path: Option<String>` and `shell_args: Option<Vec<String>>` parameters; when provided, uses them instead of `CommandBuilder::new_default_prog()`
8. Frontend passes `getSettings().shell.path` and `getSettings().shell.args` to `spawn_pty` when set
9. `mergeWithDefaults` correctly deep-merges the new sub-objects
10. All existing settings and terminal-service tests pass; new tests cover: sub-object merging, createBaseTerminal reading from settings, shell override parameters

---

## Wave 2 — Post-foundation (parallel, after Wave 1 merges)

### S4: Navigation & Breadcrumbs

**Findings addressed:** #5 (interactive breadcrumbs), #15 (Go Home / Go Settings shortcuts),
#2 (inactive projects drawer on home screen), #27 (collapsible sidebar projects),
#28 (Cmd+1-9 global vs project-scoped — add project name to command palette for disambiguation)

**Files in scope:**

- `src/lib/components/TitleBar.svelte`
- `src/lib/components/HomeScreen.svelte` (inactive projects section)
- `src/lib/components/Sidebar.svelte` (collapsible projects — ONLY the collapse toggle, no lifecycle changes)
- `src/lib/keybindings.ts` (Go Home, Go Settings shortcuts)
- `src/lib/components/App.svelte` (command palette entries for Home, Settings, per-project navigation)
- `src/lib/stores/ui.ts` (currentProjectId fix in openWorkspace)
- Tests: `src/tests/title-bar.test.ts`, `src/tests/keybindings.test.ts`, `src/tests/home-screen.test.ts`

**Files out of scope:** SettingsView.svelte, workspace-actions.ts, project.ts (lifecycle)

**TDD mode:** verify (UI) + default (keybindings logic)

**Acceptance criteria:**

1. TitleBar renders clickable breadcrumb segments: [Home icon] > [Project name] > [Workspace name], where each segment is a button
2. Clicking "Home" calls `goHome()`; clicking project name calls `goToProject(projectId)`
3. Keybinding `Cmd+Shift+H` (macOS) / `Ctrl+Shift+H` (Linux) triggers `goHome()`
4. Keybinding `Cmd+,` (macOS) / `Ctrl+,` (Linux) opens the Settings view
5. Command palette includes "Go to Dashboard", "Open Settings", and per-project "Go to: {projectName}" entries
6. `openWorkspace()` in `ui.ts` sets `currentProjectId` to the workspace's `record.projectId` instead of `null`
7. HomeScreen renders an "Inactive Projects" section (collapsed by default) showing `$inactiveProjects` with a "Reactivate" button per project
8. Sidebar project sections have a disclosure triangle toggle for collapsing/expanding workspace lists
9. Escape key (when no dialog/find bar is open) returns to the previous view or active workspace
10. All existing tests pass; new tests cover breadcrumb clicks, keyboard shortcuts, command palette entries, inactive projects section

---

### S5: Agent Orchestration UX

**Findings addressed:** #3 (OS notifications), #4 (harness keyboard shortcuts + command palette),
#14 (status color semantics), #20 (agent overview panel), #13 (sidebar "Claude" hardcode),
#31 (status dot sizing), #32 (waiting vs idle semantics), #33 (idle timeout inconsistency)

**Files in scope:**

- `src/lib/agent-utils.ts` (status color mapping)
- `src/lib/harness-status.ts` (idle timeout alignment, notification trigger)
- `src/lib/components/HarnessPlaceholder.svelte` (exit context display)
- `src/lib/components/HomeScreen.svelte` (agent section grouping by project)
- `src/lib/components/ProjectCard.svelte` (aggregate agent status display)
- `src/lib/components/Tab.svelte` (status dot sizing — 6px → 8px)
- `src/lib/terminal-service.ts` (idle timeout default alignment)
- Tests: `src/tests/agent-utils.test.ts`, `src/tests/harness-status.test.ts`, `src/tests/harness.test.ts`

**Files out of scope:** App.svelte (command palette — coordinated with S4 via shared contract),
Sidebar.svelte (label fix is scoped here but the "Claude" hardcode is a targeted string replacement),
keybindings.ts (harness shortcuts added in S4's scope since it owns that file)

**Coordination with S4:** S4 adds the command palette entries and keybindings for harness operations
(New Harness, Jump to Waiting Agent). S5 provides the `findNextWaitingAgent()` utility function
that S4's keybinding handler calls. Define this interface in the context doc.

**TDD mode:** default (logic) + verify (UI)

**Acceptance criteria:**

1. `statusColor()` in agent-utils.ts maps: idle → `theme.fgDim` (neutral), exited → `theme.success` (green for code 0), running → `theme.info` (blue), waiting → `theme.warning` (yellow), error → `theme.error` (red)
2. Harness status dot in Tab.svelte is 8px diameter (up from 6px)
3. `harness-status.ts` triggers a Tauri notification (`@tauri-apps/plugin-notification`) when status transitions to "waiting" and the app window is not focused
4. Idle timeout default is aligned: `settings.ts` DEFAULT_SETTINGS and `terminal-service.ts` fallback both use the same value (10000ms)
5. `findNextWaitingAgent(workspaces): { workspaceId, surfaceId } | null` exported from agent-utils.ts — finds the first surface with status "waiting" across all workspaces
6. Sidebar workspace agent label resolves preset name from `getSettings().harnesses` by matching `presetId`, instead of hardcoding "Claude"
7. HarnessPlaceholder shows exit code context: "Exited (code 0)" or "Exited with error (code 1)"
8. ProjectCard shows aggregate agent status line (e.g., "2 agents: 1 running, 1 waiting")
9. HomeScreen Agents section groups agents by project name
10. All existing tests pass; new tests cover: color mapping, notification trigger, findNextWaitingAgent, preset name resolution, aggregate display

---

## Wave 3 — Sequential (touches shared files from Waves 1-2)

### S6: Workspace Lifecycle UI

**Findings addressed:** #1 (lifecycle unwired), #2 (stashed/archived invisible),
#30 (archive 3-option dialog, delete confirmation)

**Files in scope:**

- `src/lib/components/Sidebar.svelte` (lifecycle context menu items, stashed/archived sections)
- `src/lib/components/App.svelte` (close → stash routing for managed workspaces)
- `src/lib/workspace-actions.ts` (close handler routing)
- `src/lib/stores/project.ts` (archive 3-option dialog, delete confirmation)
- `src/lib/components/HomeScreen.svelte` (stashed workspaces display — already has inactive projects from S4)
- `src/lib/keybindings.ts` (wire stashWorkspace keybinding)
- Tests: `src/tests/workspace-lifecycle.test.ts` (new), `src/tests/sidebar.test.ts`

**TDD mode:** default (lifecycle logic) + verify (UI)

**Acceptance criteria:**

1. Sidebar workspace context menu includes "Stash" for active managed workspaces and "Restore" for stashed workspaces
2. Sidebar workspace context menu includes "Archive" for active and stashed workspaces
3. Sidebar shows a "Stashed" subsection under each project for stashed workspaces (dimmed, with restore action)
4. Closing a managed workspace routes through `stashWorkspace()` instead of permanently deleting the record
5. `archiveWorkspace()` shows a 3-option dialog: "Push & Archive", "Archive Without Pushing", "Cancel"
6. `archiveWorkspace()` handles push failure with a specific error dialog offering retry/skip/cancel
7. `deleteWorkspace()` shows a confirmation dialog before removing the record
8. `Cmd+Shift+S` (macOS) / `Ctrl+Shift+S` (Linux) triggers stash on the current workspace
9. `restoreWorkspace()` re-opens the workspace with new PTY sessions (calls `openNewWorkspace` with existing worktree path)
10. All tests pass; new tests cover: context menu items per status, close → stash routing, 3-option archive dialog, delete confirmation, stash keybinding, restore flow

---

### S7: Settings UI

**Findings addressed:** #8 (first-run onboarding), #9 (harness preset CRUD), #10 (keybinding wiring),
#11 (custom commands CRUD), #19 (consistent save behavior), #34 (open-in-editor)

**Files in scope:**

- `src/lib/components/SettingsView.svelte` (harness CRUD, commands CRUD, terminal settings, open-in-editor, consistent save)
- `src/lib/components/ProjectSettingsView.svelte` (auto-save to match global)
- `src/lib/components/HomeScreen.svelte` (first-run conditional content)
- `src/lib/keybindings.ts` (wire settings-based keybindings from `getSettings().keybindings`)
- Tests: `src/tests/settings-view.test.ts`, `src/tests/keybindings.test.ts`

**TDD mode:** verify (UI) + default (keybinding wiring)

**Acceptance criteria:**

1. SettingsView has a "Terminal" section exposing `scrollback`, `cursorStyle`, `cursorBlink` fields (reads/writes to `settings.terminal.*`)
2. SettingsView has a "Shell" section exposing `path` and `args` fields (reads/writes to `settings.shell.*`)
3. SettingsView has a "Harnesses" section with a list of configured presets, showing name + command, with Add/Edit/Remove buttons
4. Add Harness form has fields: id, name, command, args (comma-separated), env (key=value pairs)
5. SettingsView has a "Commands" section listing custom commands with Edit/Delete buttons
6. SettingsView has an "Open settings.json" button that calls Tauri `open_with_default_app` on the settings file path
7. Both global SettingsView and ProjectSettingsView use auto-save with a "Saved" indicator (consistent pattern)
8. HomeScreen shows first-run content when `$projects.length === 0 && $workspaces.length === 0`: welcome message + "Add Your First Project" CTA + brief explanation of Projects/Workspaces/Harnesses
9. `keybindings.ts` reads action mappings from `getSettings().keybindings` and uses them instead of hardcoded key strings
10. All tests pass; new tests cover: harness CRUD operations, command CRUD, auto-save consistency, first-run content rendering, keybinding setting wiring

---

## Shared Contracts (for docgen)

### Between S4 and S5 (Wave 2 coordination)

S5 exports `findNextWaitingAgent()` from `agent-utils.ts`.
S4 imports it in `keybindings.ts` to wire the "jump to waiting agent" shortcut.

**Interface contract:**

```typescript
// agent-utils.ts (S5 provides)
export function findNextWaitingAgent(
  workspaces: Workspace[],
): { workspaceId: string; surfaceId: string } | null;
```

S4 adds command palette entries referencing this function. Since S4 and S5 run in parallel,
S4 should stub the import and S5 provides the real implementation. On merge, the stub is replaced.

### Between S3 and S7 (Wave 1 → Wave 3)

S3 defines the new `Settings` sub-interfaces (`terminal`, `shell`, `accessibility`, `harness` sub-objects).
S7 builds UI controls for them. S7 depends on S3 being merged first — this is enforced by wave ordering.

---

## Merge Order

```
Wave 1 (parallel):  S1, S2, S3  →  merge in any order
Wave 2 (parallel):  S4, S5      →  merge in any order (after all Wave 1 merged)
Wave 3 (sequential): S6 → S7    →  merge in order (after all Wave 2 merged)
```

## Integration Verification

After each wave merge:

- `npm test` (all vitest tests pass)
- `cargo test` (Rust tests pass, only after S3 which touches Rust)
- `npm run build` (full Tauri build succeeds)
