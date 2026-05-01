<script lang="ts">
  import type { NestedWorkspace } from "../../../../lib/types";
  import { nestedWorkspaces } from "../../../../lib/stores/nested-workspace";

  export let filterIds: Set<string> | undefined = undefined;
  export let accentColor: string | undefined = undefined;
  export let dashboardHintFor:
    | ((
        ws: NestedWorkspace,
      ) => { id: string; color?: string; onClick: () => void } | undefined)
    | undefined = undefined;
  export let hideStatusBadges: boolean = false;

  // Reflect the real WorkspaceListView contract: it reads the global
  // nestedWorkspaces store filtered by filterIds and passes full NestedWorkspace
  // objects (including metadata) to its per-row hooks. The stub must do
  // the same, otherwise dashboardHintFor gets a stripped workspace with
  // no metadata and the hint resolves to undefined.
  $: rows = $nestedWorkspaces.filter((ws) =>
    filterIds ? filterIds.has(ws.id) : true,
  );
</script>

<div
  data-workspace-list-view-stub
  data-accent-color={accentColor ?? ""}
  data-filter-count={rows.length}
  data-hide-status-badges={hideStatusBadges ? "true" : "false"}
>
  {#each rows as ws (ws.id)}
    {@const hint = dashboardHintFor?.(ws as unknown as NestedWorkspace)}
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
