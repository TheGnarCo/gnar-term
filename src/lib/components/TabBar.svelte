<script lang="ts">
  import { theme } from "../stores/theme";
  import Tab from "./Tab.svelte";
  import NewSurfaceButton from "./NewSurfaceButton.svelte";
  import type { Pane } from "../types";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import {
    agentDotColorForSurface,
    agentStatusForSurface,
  } from "../status-colors";
  import type { StatusItem } from "../types/status";
  import type { Readable } from "svelte/store";
  import { readable } from "svelte/store";
  import { tabDragState } from "../services/tab-drag";

  const emptyStore: Readable<StatusItem[]> = readable([]);

  export let pane: Pane;
  export let workspaceId: string = "";
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSelectSurfaceType: (typeId: string) => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let showJumpToBottom: boolean = false;
  export let onJumpToBottom: (() => void) | undefined = undefined;

  $: processStatusStore = workspaceId
    ? getWorkspaceStatusByCategory(workspaceId, "process")
    : emptyStore;
  $: processItems = $processStatusStore;

  // Live tab-drag state — drives the within-pane reorder insert
  // indicator and the cross-pane split outline.
  $: drag = $tabDragState;
  $: reorderInsertIdx =
    drag?.dropTarget?.kind === "reorder" && drag.dropTarget.paneId === pane.id
      ? drag.dropTarget.insertIdx
      : null;
  $: isSplitTarget =
    drag?.dropTarget?.kind === "split" && drag.dropTarget.paneId === pane.id;
</script>

<div
  data-pane-id={pane.id}
  style="
    display: flex; align-items: center; gap: 1px; position: relative;
    background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
    height: 28px; padding: 0 4px; flex-shrink: 0; overflow-x: auto;
    scrollbar-width: none;
    {isSplitTarget
    ? `outline: 2px solid ${$theme.accent}; outline-offset: -2px;`
    : ''}
  "
>
  {#each pane.surfaces as surface, i (surface.id)}
    {#if reorderInsertIdx === i}
      <span
        aria-hidden="true"
        style="
          width: 2px; align-self: stretch; background: {$theme.accent};
          flex-shrink: 0; border-radius: 1px;
        "
      ></span>
    {/if}
    <Tab
      {surface}
      index={i}
      isActive={surface.id === pane.activeSurfaceId}
      paneId={pane.id}
      {workspaceId}
      onSelect={() => onSelectSurface(surface.id)}
      onClose={() => onCloseSurface(surface.id)}
      agentDotColor={agentDotColorForSurface(processItems, surface.id)}
      agentStatus={agentStatusForSurface(processItems, surface.id)}
    />
  {/each}
  {#if reorderInsertIdx === pane.surfaces.length}
    <span
      aria-hidden="true"
      style="
        width: 2px; align-self: stretch; background: {$theme.accent};
        flex-shrink: 0; border-radius: 1px;
      "
    ></span>
  {/if}

  <NewSurfaceButton {onNewSurface} {onSelectSurfaceType} />

  <div style="flex: 1;"></div>

  <div
    style="display: flex; align-items: center; gap: 2px; padding-right: 2px;"
  >
    {#if showJumpToBottom && onJumpToBottom}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        data-jump-to-bottom
        title="Jump to bottom"
        style="color: {$theme.fgDim}; cursor: pointer; height: 20px; border-radius: 4px; display: flex; align-items: center; gap: 4px; padding: 0 6px; font-size: 11px; border: 1px solid {$theme.border};"
        on:click|stopPropagation={onJumpToBottom}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="5" y1="1" x2="5" y2="9" />
          <polyline points="2,6 5,9 8,6" />
        </svg>
        Jump to bottom
      </span>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Split Right (⌘D)"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitRight}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        ><rect x="1" y="1" width="12" height="12" rx="1" /><line
          x1="7"
          y1="1"
          x2="7"
          y2="13"
        /></svg
      >
    </span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Split Down (⇧⌘D)"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitDown}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        ><rect x="1" y="1" width="12" height="12" rx="1" /><line
          x1="1"
          y1="7"
          x2="13"
          y2="7"
        /></svg
      >
    </span>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Close Pane"
      style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onClosePane}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        ><line x1="2" y1="2" x2="10" y2="10" /><line
          x1="10"
          y1="2"
          x2="2"
          y2="10"
        /></svg
      >
    </span>
  </div>
</div>
