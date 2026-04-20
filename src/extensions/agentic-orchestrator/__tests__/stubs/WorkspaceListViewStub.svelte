<script lang="ts">
  import type { Workspace } from "../../../../lib/types";
  import { workspaces } from "../../../../lib/stores/workspace";

  export let filterIds: Set<string> | undefined = undefined;
  export let accentColor: string | undefined = undefined;
  export let dashboardHintFor:
    | ((
        ws: Workspace,
      ) => { id: string; color?: string; onClick: () => void } | undefined)
    | undefined = undefined;

  // Reflect the real WorkspaceListView contract: it reads the global
  // workspaces store filtered by filterIds and passes full Workspace
  // objects (including metadata) to its per-row hooks. The stub must do
  // the same, otherwise dashboardHintFor gets a stripped workspace with
  // no metadata and the hint resolves to undefined.
  $: rows = $workspaces.filter((ws) =>
    filterIds ? filterIds.has(ws.id) : true,
  );
</script>

<div
  data-workspace-list-view-stub
  data-accent-color={accentColor ?? ""}
  data-filter-count={rows.length}
>
  {#each rows as ws (ws.id)}
    {@const hint = dashboardHintFor?.(ws as unknown as Workspace)}
    <button
      type="button"
      data-stub-row={ws.id}
      data-stub-hint-id={hint?.id ?? ""}
      on:click={() => hint?.onClick()}
    >
      {ws.name}
    </button>
  {/each}
</div>
