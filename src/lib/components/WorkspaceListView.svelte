<script lang="ts">
  /**
   * WorkspaceListView — renders a filtered list of WorkspaceItems
   * with full interaction support (click, close, rename, context menu).
   *
   * Used by PrimarySidebar for the main workspace list and by extensions
   * for scoped workspace lists in their own sidebar sections.
   */
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import {
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
  } from "../services/workspace-service";
  import WorkspaceItem from "./WorkspaceItem.svelte";

  /** Set of workspace IDs to display. If undefined, shows all. */
  export let filterIds: Set<string> | undefined = undefined;

  /** Project accent color passed to each WorkspaceItem for left-border coloring. */
  export let accentColor: string | undefined = undefined;

  $: entries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => (filterIds ? filterIds.has(ws.id) : true));
</script>

{#each entries as entry (entry.ws.id)}
  <WorkspaceItem
    workspace={entry.ws}
    index={entry.idx}
    isActive={entry.idx === $activeWorkspaceIdx}
    dragActive={false}
    {accentColor}
    onSelect={() => switchWorkspace(entry.idx)}
    onClose={() => closeWorkspace(entry.idx)}
    onRename={(name) => renameWorkspace(entry.idx, name)}
    onContextMenu={() => {}}
  />
{/each}

{#if entries.length === 0}
  <div
    style="
      padding: 4px 12px; font-size: 10px;
      color: {$theme.fgDim}; font-style: italic;
    "
  >
    No workspaces
  </div>
{/if}
