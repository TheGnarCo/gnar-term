<script lang="ts">
  /**
   * `gnar:worktrees` — lists the open worktrees rooted at the
   * Workspace's repo path. Each row surfaces the branch name,
   * the base branch, and (when a workspace is bound) a click-to-jump
   * affordance that switches to that worktree workspace.
   *
   * Scope comes from the enclosing `DashboardHostContext`:
   *   - group scope  → filter to `group.path` as the repo
   *   - global scope → filter to `repoPath` config when provided;
   *     otherwise show every persisted worktree
   *   - none         → widget is inert
   */
  import { theme } from "../stores/theme";
  import { getWorkspaceGroup } from "../stores/workspace-groups";
  import {
    deriveDashboardScope,
    getDashboardHost,
  } from "../contexts/dashboard-host";
  import { worktreeEntriesStore } from "../services/worktree-service";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";

  /** Explicit repo override under global scope. */
  export let repoPath: string | undefined = undefined;

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  function resolveRepoPath(): string | null {
    if (scope.kind === "group") {
      const g = getWorkspaceGroup(scope.groupId);
      return g?.path ?? null;
    }
    if (scope.kind === "global") {
      return repoPath?.trim() || null;
    }
    return null;
  }

  $: repoFilter = resolveRepoPath();

  $: entries = $worktreeEntriesStore.filter((e) => {
    if (scope.kind === "none") return false;
    if (!repoFilter) return scope.kind === "global";
    return e.repoPath.replace(/\/+$/, "") === repoFilter.replace(/\/+$/, "");
  });

  function shortWorktreePath(path: string): string {
    const parts = path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? path;
  }

  function jumpToWorktree(workspaceId: string | undefined): void {
    if (!workspaceId) return;
    const idx = $workspaces.findIndex((w) => w.id === workspaceId);
    if (idx >= 0) activeWorkspaceIdx.set(idx);
  }
</script>

<div
  data-worktrees
  data-scope-kind={scope.kind}
  style="
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
    font-size: 13px; color: {$theme.fg};
  "
>
  <div style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
    <span
      aria-hidden="true"
      style="color: {$theme.fgDim}; font-family: monospace;">⎇</span
    >
    <span>Worktrees</span>
    <span style="margin-left: auto; color: {$theme.fgDim}; font-size: 11px;"
      >{entries.length}</span
    >
  </div>

  {#if scope.kind === "none"}
    <div data-worktrees-no-scope style="color: {$theme.fgDim};">
      Mount inside a Workspace dashboard to see worktrees.
    </div>
  {:else if entries.length === 0}
    <div
      data-worktrees-empty
      style="color: {$theme.fgDim}; font-style: italic;"
    >
      No worktrees for this repo yet.
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 4px;">
      {#each entries as entry (entry.worktreePath)}
        {@const hasWorkspace = !!entry.workspaceId}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          data-worktree-row
          data-branch={entry.branch}
          role={hasWorkspace ? "button" : undefined}
          tabindex={hasWorkspace ? 0 : undefined}
          on:click={() => jumpToWorktree(entry.workspaceId)}
          on:keydown={(e) => {
            if (hasWorkspace && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              jumpToWorktree(entry.workspaceId);
            }
          }}
          style="
            display: flex; align-items: center; gap: 10px;
            padding: 6px 8px; border-radius: 4px;
            background: {$theme.bg}; border: 1px solid {$theme.border};
            cursor: {hasWorkspace ? 'pointer' : 'default'};
            transition: background 0.15s;
          "
        >
          <span
            style="font-family: monospace; color: {$theme.fg}; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
            >{entry.branch}</span
          >
          <span
            style="color: {$theme.fgDim}; font-size: 11px; font-family: monospace;"
            title={entry.worktreePath}
            >~/{shortWorktreePath(entry.worktreePath)}</span
          >
          <span
            style="color: {$theme.fgDim}; font-size: 11px;"
            title="Base branch">← {entry.baseBranch}</span
          >
          {#if hasWorkspace}
            <span
              style="color: {$theme.accent}; font-size: 11px;"
              title="Click to jump to this workspace">Open ↗</span
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
