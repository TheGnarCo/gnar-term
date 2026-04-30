# Worktree Settings Design

**Date:** 2026-04-23

## Summary

Add a Worktrees settings tab to SettingsOverlay that exposes the worktree base directory, pre-create commands, and post-create commands. Change the default worktree path from a sibling directory to a global `~/.gnar-term/worktrees` pool, configurable to a repo-relative path. Remove the legacy `setupScript` field.

## Data Model

`WorktreesSettings` in `src/lib/config.ts`:

```ts
export interface WorktreesSettings {
  branchPrefix?: string;
  copyPatterns?: string;
  mergeStrategy?: "merge" | "squash" | "rebase";
  // new:
  worktreeBaseDir?: string; // relative to repo root; unset = global ~/.gnar-term/worktrees
  preCreateCommands?: string; // newline-separated; run in repo root before create
  postCreateCommands?: string; // newline-separated; run in worktree dir after create
}
```

`setupScript` is removed (was unused in the UI; `postCreateCommands` covers the same intent).

## Default Worktree Path

Current: `{parentDir}/{repoName}-{branch}` (sibling directory, clutters parent)

New logic in `promptWorktreeConfig` (`worktree-helpers.ts`):

- **`worktreeBaseDir` unset**: `~/.gnar-term/worktrees/{repoName}-{branch}`
- **`worktreeBaseDir` set** (e.g. `.gnar-term/worktrees`): `{repoPath}/{worktreeBaseDir}/{branch-sanitized}`

Branch sanitization: replace `/` with `-` (existing behavior preserved).

The computed path pre-fills the editable path field in the create-worktree dialog — user can still override it per-creation.

## Settings UI

New **Worktrees** tab in `SettingsOverlay.svelte` alongside General / Extensions. Renders a new `WorktreeSettings.svelte` component.

### Fields

**Worktree directory** (text input)

- Placeholder: `(blank = ~/.gnar-term/worktrees)`
- Help text: "Relative path from repo root. Leave blank to use the global worktree pool."
- A resolved-path hint line shows the full path for the active workspace's repo.

**Before create** (textarea)

- Label: "Commands to run before creating the worktree (one per line)"
- Help text: "Runs in the repo root directory. Creation aborts if any command fails."

**After create** (textarea)

- Label: "Commands to run after creating the worktree (one per line)"
- Help text: "Runs in the new worktree directory. Failures are logged but do not roll back."

Changes persist on blur to `config.worktrees.settings` via `saveConfig`.

## Command Execution

A new Tauri command `run_shell_command(cmd: string, cwd: string) -> Result<(), String>` executes a single shell command. If an equivalent command already exists, reuse it.

**Pre-create flow:**

1. Split `preCreateCommands` on newlines, filter empty.
2. For each command: `invoke("run_shell_command", { cmd, cwd: repoPath })`.
3. On non-zero exit: surface error, abort worktree creation.

**Post-create flow:**

1. Split `postCreateCommands` on newlines, filter empty.
2. For each command: `invoke("run_shell_command", { cmd, cwd: worktreePath })`.
3. On failure: `console.error` log only, creation is not rolled back.

## Affected Files

- `src/lib/config.ts` — update `WorktreesSettings` (remove `setupScript`, add three fields)
- `src/lib/services/worktree-helpers.ts` — change path computation in `promptWorktreeConfig`
- `src/lib/services/worktree-service.ts` — add pre/post command execution around `createWorktree`
- `src/lib/components/SettingsOverlay.svelte` — add Worktrees tab
- `src/lib/components/WorktreeSettings.svelte` — new component
- `src-tauri/src/` — add `run_shell_command` Tauri command (or reuse existing)

## Testing

- Unit: path computation with and without `worktreeBaseDir` set
- Unit: command splitting (empty lines filtered, multi-command ordering)
- Unit: pre-create abort when first command fails
- Integration: settings persist and reload across sessions
