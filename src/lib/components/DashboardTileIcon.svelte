<script lang="ts">
  /**
   * DashboardTileIcon — renders a dashboard contribution's icon with
   * an optional state-driven color override.
   *
   * Today the only color override is for the `"diff"` contribution:
   * when the group's working tree has uncommitted changes, the icon
   * switches from the group accent color to an amber warning tone so
   * the tile functions as a passive "changes to review" indicator.
   * When clean, the icon reverts to the base accent.
   */
  import type { Component, ComponentType } from "svelte";
  import { readable, type Readable } from "svelte/store";
  import {
    groupDirtyStore,
    type GroupDirtyState,
  } from "../services/group-git-dirty-store";

  export let iconComponent: Component | ComponentType | unknown;
  export let baseColor: string;
  export let contributionId: string | undefined;
  export let groupPath: string | undefined;

  const CLEAN_STATE: GroupDirtyState = { ready: true, hasChanges: false };

  const dirtyStore: Readable<GroupDirtyState> =
    contributionId === "diff" && groupPath
      ? groupDirtyStore(groupPath)
      : readable(CLEAN_STATE);

  $: color = $dirtyStore.hasChanges ? "#e8b73a" : baseColor;
</script>

<span
  class="dashboard-tile-icon"
  data-dirty={$dirtyStore.hasChanges ? "true" : undefined}
  aria-hidden="true"
  style="color: {color};"
>
  <svelte:component
    this={iconComponent as Component}
    size={14}
    color="currentColor"
  />
</span>

<style>
  .dashboard-tile-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }
</style>
