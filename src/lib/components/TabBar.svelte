<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { theme } from "../stores/theme";
  import Tab from "./Tab.svelte";
  import type { Pane } from "../types";

  export let pane: Pane;
  export let workspaceId: string;
  export let paneIsActive: boolean = false;
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;

  // Overflow scroll affordance: when the tab strip overflows its width the
  // scrollbar is hidden, so without chevrons the off-screen tabs are
  // unreachable. Track scroll position to show ‹ / › only when scrollable.
  let scrollEl: HTMLElement;
  let canScrollLeft = false;
  let canScrollRight = false;
  let resizeObserver: ResizeObserver;

  function updateScroll() {
    if (!scrollEl) return;
    canScrollLeft = scrollEl.scrollLeft > 0;
    canScrollRight =
      scrollEl.scrollLeft + scrollEl.clientWidth < scrollEl.scrollWidth - 1;
  }

  function scrollBy(delta: number) {
    scrollEl?.scrollBy({ left: delta, behavior: "smooth" });
    // scrollBy is async; re-read after it settles.
    setTimeout(updateScroll, 200);
  }

  // Re-check overflow whenever the tab set changes.
  $: if (scrollEl) { void pane.surfaces.length; tick().then(updateScroll); }

  onMount(() => {
    updateScroll();
    resizeObserver = new ResizeObserver(updateScroll);
    if (scrollEl) resizeObserver.observe(scrollEl);
  });
  onDestroy(() => resizeObserver?.disconnect());
</script>

<div
  data-pane-id={pane.id}
  style="
    display: flex; align-items: center; gap: 1px;
    background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
    height: 28px; padding: 0 4px; flex-shrink: 0;
  "
>
  {#if canScrollLeft}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Scroll tabs left"
      style="color: {$theme.fgDim}; cursor: pointer; padding: 0 2px; font-size: 12px; flex-shrink: 0;"
      on:click|stopPropagation={() => scrollBy(-120)}
    >‹</span>
  {/if}
  <div
    bind:this={scrollEl}
    on:scroll={updateScroll}
    style="display: flex; align-items: center; gap: 1px; overflow-x: auto; scrollbar-width: none; flex: 0 1 auto; min-width: 0;"
  >
    {#each pane.surfaces as surface, i (surface.id)}
      <Tab
        {surface}
        index={i}
        isActive={surface.id === pane.activeSurfaceId}
        {paneIsActive}
        paneId={pane.id}
        {workspaceId}
        onSelect={() => onSelectSurface(surface.id)}
        onClose={() => onCloseSurface(surface.id)}
      />
    {/each}
  </div>
  {#if canScrollRight}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      title="Scroll tabs right"
      style="color: {$theme.fgDim}; cursor: pointer; padding: 0 2px; font-size: 12px; flex-shrink: 0;"
      on:click|stopPropagation={() => scrollBy(120)}
    >›</span>
  {/if}

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
