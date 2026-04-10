<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  interface ManagedWorkspaceEntry {
    workspaceId: string;
    worktreePath: string;
    branch: string;
    baseBranch: string;
    repoPath: string;
    createdAt: string;
  }

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const activeWorkspace = api.activeWorkspace;

  let entries: ManagedWorkspaceEntry[] = [];

  $: {
    void $activeWorkspace;
    entries = api.state.get<ManagedWorkspaceEntry[]>("managedWorkspaces") || [];
  }

  function activateWorkspace(entry: ManagedWorkspaceEntry) {
    api.createWorkspace(entry.branch, entry.worktreePath, {
      metadata: {
        worktreePath: entry.worktreePath,
        branch: entry.branch,
        baseBranch: entry.baseBranch,
        repoPath: entry.repoPath,
      },
    });
  }

  function getRepoName(repoPath: string): string {
    return repoPath.split("/").pop() || repoPath;
  }
</script>

<div style="padding: 4px 0;">
  {#if entries.length === 0}
    <div
      style="
        padding: 8px 12px;
        font-size: 11px;
        color: {$theme.fgDim};
      "
    >
      No managed workspaces. Use the command palette to create one.
    </div>
  {:else}
    {#each entries as entry (entry.branch + entry.repoPath)}
      <button
        style="
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 6px 12px;
          border: none;
          background: transparent;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
        "
        on:click={() => activateWorkspace(entry)}
        on:mouseenter={(e) =>
          (e.currentTarget.style.background = $theme.border)}
        on:mouseleave={(e) =>
          (e.currentTarget.style.background = "transparent")}
      >
        <span
          style="
            width: 6px;
            height: 6px;
            border-radius: 50%;
            flex-shrink: 0;
            background: {$activeWorkspace?.name === entry.branch
            ? $theme.accent
            : $theme.fgDim};
          "
        ></span>
        <div style="min-width: 0; overflow: hidden;">
          <div
            style="
              font-size: 12px;
              color: {$theme.fg};
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            "
          >
            {entry.branch}
          </div>
          <div style="font-size: 10px; color: {$theme.fgDim};">
            {getRepoName(entry.repoPath)}
          </div>
        </div>
      </button>
    {/each}
  {/if}
</div>
