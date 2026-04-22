<script lang="ts">
  /**
   * DashboardTileIcon — renders a dashboard contribution's icon with
   * an optional state-driven color override.
   *
   * The `"diff"` contribution has its own color contract distinct from
   * every other tile: it never paints with the group accent. Instead it
   * is a binary indicator —
   *   • dirty (uncommitted changes in the group's working tree) →
   *     amber warning tone, signalling "changes to review"
   *   • clean → muted/dim foreground, so the tile recedes when there's
   *     nothing to look at
   * Other contribution ids paint with `baseColor` as today.
   */
  import type { Component, ComponentType } from "svelte";
  import { readable, type Readable } from "svelte/store";
  import {
    groupDirtyStore,
    type GroupDirtyState,
  } from "../services/group-git-dirty-store";
  import { theme } from "../stores/theme";

  export let iconComponent: Component | ComponentType | unknown;
  export let baseColor: string;
  export let contributionId: string | undefined;
  export let groupPath: string | undefined;

  const CLEAN_STATE: GroupDirtyState = { ready: true, hasChanges: false };

  $: isDiff = contributionId === "diff";

  const dirtyStore: Readable<GroupDirtyState> =
    contributionId === "diff" && groupPath
      ? groupDirtyStore(groupPath)
      : readable(CLEAN_STATE);

  $: dimColor = ($theme["fgDim"] ?? $theme.fgMuted ?? "#888") as string;
  $: color = isDiff
    ? $dirtyStore.hasChanges
      ? "#e8b73a"
      : dimColor
    : baseColor;
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
