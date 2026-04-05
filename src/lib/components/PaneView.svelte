<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import type { Pane } from "../types";
  import { isTerminalSurface, isPreviewSurface } from "../types";

  export let pane: Pane;
  export let isActivePane: boolean;
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onFocusPane: () => void;
  export let onReorderTab: ((fromIdx: number, toIdx: number) => void) | undefined = undefined;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  function fitActiveTerminal() {
    const active = pane.surfaces.find(s => s.id === pane.activeSurfaceId);
    if (active && isTerminalSurface(active)) {
      try { active.fitAddon.fit(); } catch {}
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
  style="
    flex: 1; display: flex; flex-direction: column;
    min-width: 0; min-height: 0;
    border: 1px solid {isActivePane ? $theme.borderActive : $theme.border};
    border-radius: 4px; overflow: hidden;
  "
  on:mousedown={onFocusPane}
>
  <TabBar
    {pane}
    {onSelectSurface}
    {onCloseSurface}
    {onNewSurface}
    {onSplitRight}
    {onSplitDown}
    {onClosePane}
    {onReorderTab}
  />

  {#each pane.surfaces as surface (surface.id)}
    {#if isTerminalSurface(surface)}
      <TerminalSurface {surface} visible={surface.id === pane.activeSurfaceId} cwd={surface.cwd} />
    {:else if isPreviewSurface(surface)}
      <PreviewSurface {surface} visible={surface.id === pane.activeSurfaceId} />
    {/if}
  {/each}
</div>
