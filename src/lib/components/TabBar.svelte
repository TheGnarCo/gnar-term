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
  import { workspaceDragState } from "../services/workspace-drag";
  import { onMount, afterUpdate } from "svelte";

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
  export let onRefreshPreview: (() => void) | undefined = undefined;

  $: activeIsPreview =
    pane.surfaces.find((s) => s.id === pane.activeSurfaceId)?.kind ===
    "preview";

  $: processStatusStore = workspaceId
    ? getWorkspaceStatusByCategory(workspaceId, "process")
    : emptyStore;
  $: processItems = $processStatusStore;

  $: drag = $tabDragState;
  $: reorderInsertIdx =
    drag?.dropTarget?.kind === "reorder" && drag.dropTarget.paneId === pane.id
      ? drag.dropTarget.insertIdx
      : null;
  $: isSplitTarget =
    drag?.dropTarget?.kind === "merge" && drag.dropTarget.paneId === pane.id;
  $: isWorkspaceMergeTarget =
    $workspaceDragState?.dropTarget?.kind === "tab-merge" &&
    $workspaceDragState.dropTarget.paneId === pane.id;

  let tabsEl: HTMLDivElement | null = null;
  let canScrollLeft = false;
  let canScrollRight = false;

  function updateScrollState() {
    if (!tabsEl) return;
    canScrollLeft = tabsEl.scrollLeft > 0;
    canScrollRight =
      tabsEl.scrollLeft < tabsEl.scrollWidth - tabsEl.clientWidth - 1;
  }

  onMount(() => {
    updateScrollState();
    const ro = new ResizeObserver(updateScrollState);
    if (tabsEl) ro.observe(tabsEl);
    return () => ro.disconnect();
  });

  afterUpdate(updateScrollState);
</script>

<div
  style="
    display: flex; align-items: center; position: relative;
    background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
    height: 28px; flex-shrink: 0;
    {isSplitTarget || isWorkspaceMergeTarget
    ? `outline: 2px solid ${$theme.accent}; outline-offset: -2px;`
    : ''}
  "
>
  {#if canScrollLeft}
    <button
      aria-label="Scroll tabs left"
      on:click={() => tabsEl?.scrollBy({ left: -120, behavior: "smooth" })}
      style="
        background: none; border: none; padding: 0; font: inherit;
        color: {$theme.fgDim}; cursor: pointer; width: 20px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 14px; line-height: 1;
        -webkit-app-region: no-drag;
      ">‹</button
    >
  {/if}

  <div
    role="tablist"
    data-pane-id={pane.id}
    bind:this={tabsEl}
    on:scroll={updateScrollState}
    style="
      display: flex; align-items: center; gap: 1px; flex: 1; min-width: 0;
      padding: 0 4px; overflow-x: auto; scrollbar-width: none;
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
  </div>

  {#if canScrollRight}
    <button
      aria-label="Scroll tabs right"
      on:click={() => tabsEl?.scrollBy({ left: 120, behavior: "smooth" })}
      style="
        background: none; border: none; padding: 0; font: inherit;
        color: {$theme.fgDim}; cursor: pointer; width: 20px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 14px; line-height: 1;
        -webkit-app-region: no-drag;
      ">›</button
    >
  {/if}

  <div
    style="display: flex; align-items: center; gap: 2px; padding-right: 2px; flex-shrink: 0;"
  >
    {#if showJumpToBottom && onJumpToBottom}
      <button
        data-jump-to-bottom
        aria-label="Jump to bottom"
        title="Jump to bottom"
        style="background: none; border: 1px solid {$theme.border}; padding: 0 6px; font: inherit; color: {$theme.fgDim}; cursor: pointer; height: 20px; border-radius: 4px; display: flex; align-items: center; gap: 4px; font-size: 11px;"
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
          aria-hidden="true"
        >
          <line x1="5" y1="1" x2="5" y2="9" />
          <polyline points="2,6 5,9 8,6" />
        </svg>
        Jump to bottom
      </button>
    {/if}
    {#if activeIsPreview && onRefreshPreview}
      <button
        aria-label="Refresh Preview"
        title="Refresh Preview"
        style="background: none; border: none; padding: 0; font: inherit; color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
        on:click|stopPropagation={onRefreshPreview}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          ><path d="M2 7a5 5 0 1 1 1.5 3.5" /><polyline
            points="2 11 2 7 6 7"
          /></svg
        >
      </button>
    {/if}
    <button
      aria-label="Split Right (⌘D)"
      title="Split Right (⌘D)"
      style="background: none; border: none; padding: 0; font: inherit; color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitRight}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
        ><rect x="1" y="1" width="12" height="12" rx="1" /><line
          x1="7"
          y1="1"
          x2="7"
          y2="13"
        /></svg
      >
    </button>
    <button
      aria-label="Split Down (⇧⌘D)"
      title="Split Down (⇧⌘D)"
      style="background: none; border: none; padding: 0; font: inherit; color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
      on:click|stopPropagation={onSplitDown}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
        ><rect x="1" y="1" width="12" height="12" rx="1" /><line
          x1="1"
          y1="7"
          x2="13"
          y2="7"
        /></svg
      >
    </button>
    <button
      aria-label="Close Pane"
      title="Close Pane"
      style="background: none; border: none; padding: 0; font: inherit; color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
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
        aria-hidden="true"
        ><line x1="2" y1="2" x2="10" y2="10" /><line
          x1="10"
          y1="2"
          x2="2"
          y2="10"
        /></svg
      >
    </button>
  </div>
</div>
