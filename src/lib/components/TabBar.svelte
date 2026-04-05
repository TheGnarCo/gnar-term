<script lang="ts">
  import { theme } from "../stores/theme";
  import Tab from "./Tab.svelte";
  import type { Pane } from "../types";

  export let pane: Pane;
  export let isActivePane: boolean;
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onReorderTab: ((fromIdx: number, toIdx: number) => void) | undefined = undefined;
</script>

<div
  style="
    display: flex; align-items: center; gap: 1px;
    background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
    height: 28px; padding: 0 4px; flex-shrink: 0; overflow-x: auto;
    scrollbar-width: none;
  "
>
  {#each pane.surfaces as surface, i (surface.id)}
    <Tab
      {surface}
      index={i}
      isActive={surface.id === pane.activeSurfaceId}
      onSelect={() => onSelectSurface(surface.id)}
      onClose={() => onCloseSurface(surface.id)}
      onReorder={onReorderTab}
    />
  {/each}

  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    title="New surface (⌘T)"
    style="color: {$theme.fgDim}; cursor: pointer; font-size: 14px; padding: 0 6px;"
    on:click={onNewSurface}
  >+</span>

  <div style="flex: 1;"></div>

  <div style="display: flex; align-items: center; gap: 2px; padding-right: 2px;">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Split Right (⌘D)"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitRight}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="1"/><line x1="7" y1="1" x2="7" y2="13"/></svg>
    </span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Split Down (⇧⌘D)"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitDown}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="1"/><line x1="1" y1="7" x2="13" y2="7"/></svg>
    </span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Close Pane"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onClosePane}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
    </span>
  </div>
</div>
