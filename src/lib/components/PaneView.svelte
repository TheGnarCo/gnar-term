<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import type { Pane } from "../types";
  import { isTerminalSurface, isPreviewSurface } from "../types";
  import { tabDragState } from "../services/tab-drag";

  export let pane: Pane;
  export let workspaceId: string;
  /** True when this is the workspace's focused pane — drives the focus border
   *  and dims the others. */
  export let isActive: boolean = false;
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onFocusPane: () => void;

  // Directional split-zone highlight while a tab is dragged over this pane body.
  $: surfaceSplitZone =
    $tabDragState?.dropTarget?.kind === "surface-split" &&
    $tabDragState.dropTarget.paneId === pane.id
      ? $tabDragState.dropTarget.zone
      : null;
  // Whole-pane highlight while a tab is dragged onto this pane to merge.
  $: mergeTarget =
    $tabDragState?.dropTarget?.kind === "merge" &&
    $tabDragState.dropTarget.paneId === pane.id;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  function fitActiveTerminal() {
    const active = pane.surfaces.find(s => s.id === pane.activeSurfaceId);
    if (active && isTerminalSurface(active)) {
      try { active.fitAddon.fit(); } catch (e) { console.warn("fitAddon.fit() failed on resize:", e); }
    }
  }

  onMount(() => {
    pane.element = paneEl;
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitActiveTerminal, 50);
    });
    resizeObserver.observe(paneEl);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={paneEl}
  data-pane-body={pane.id}
  style="
    flex: 1; display: flex; flex-direction: column;
    min-width: 0; min-height: 0; position: relative;
    border: 1px solid {isActive || mergeTarget ? $theme.accent : $theme.border};
    border-radius: 4px; overflow: hidden;
  "
  on:mousedown={onFocusPane}
>
  <!-- Content wrapper carries the inactive-pane dimming so the drag overlays
       below stay at full opacity. -->
  <div
    style="
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0;
      opacity: {isActive ? 1 : 0.5}; transition: opacity 0.15s;
    "
  >
    <TabBar
      {pane}
      {workspaceId}
      paneIsActive={isActive}
      {onSelectSurface}
      {onCloseSurface}
      {onNewSurface}
      {onSplitRight}
      {onSplitDown}
      {onClosePane}
    />

    {#each pane.surfaces as surface (surface.id)}
      {#if isTerminalSurface(surface)}
        <TerminalSurface {surface} visible={surface.id === pane.activeSurfaceId} cwd={surface.cwd} />
      {:else if isPreviewSurface(surface)}
        <PreviewSurface {surface} visible={surface.id === pane.activeSurfaceId} />
      {/if}
    {/each}
  </div>

  {#if surfaceSplitZone}
    <div
      aria-hidden="true"
      style="
        position: absolute; pointer-events: none; z-index: 100;
        background: {$theme.accent}33; border: 2px solid {$theme.accent};
        {surfaceSplitZone === 'top' ? 'top: 28px; left: 0; right: 0; bottom: 50%;' : ''}
        {surfaceSplitZone === 'bottom' ? 'top: 50%; left: 0; right: 0; bottom: 0;' : ''}
        {surfaceSplitZone === 'left' ? 'top: 28px; left: 0; bottom: 0; right: 50%;' : ''}
        {surfaceSplitZone === 'right' ? 'top: 28px; left: 50%; bottom: 0; right: 0;' : ''}
      "
    ></div>
  {/if}
</div>
