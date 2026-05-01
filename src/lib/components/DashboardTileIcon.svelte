<script lang="ts">
  /**
   * DashboardTileIcon — renders a dashboard contribution's icon with
   * state-driven color.
   *
   * Color rules (in priority order):
   *   1. diff + dirty      → amber warning tone ("changes to review")
   *   2. isActive/isHovered → baseColor (group accent)
   *   3. otherwise         → dimColor (uniform inactive appearance)
   */
  import type { Component, ComponentType } from "svelte";
  import { readable, type Readable } from "svelte/store";
  import {
    workspaceDirtyStore,
    type WorkspaceDirtyState,
  } from "../services/workspace-git-dirty-store";
  import { theme } from "../stores/theme";

  export let iconComponent: Component | ComponentType | unknown;
  export let baseColor: string;
  export let contributionId: string | undefined;
  export let workspacePath: string | undefined;
  export let isActive: boolean = false;
  export let isHovered: boolean = false;

  const CLEAN_STATE: WorkspaceDirtyState = { ready: true, hasChanges: false };

  $: isDiff = contributionId === "diff";

  const dirtyStore: Readable<WorkspaceDirtyState> =
    contributionId === "diff" && workspacePath
      ? workspaceDirtyStore(workspacePath)
      : readable(CLEAN_STATE);

  $: dimColor = ($theme["fgDim"] ?? $theme.fgMuted ?? "#888") as string;
  $: color =
    isDiff && $dirtyStore.hasChanges
      ? "#e8b73a"
      : isActive || isHovered
        ? baseColor
        : dimColor;
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
