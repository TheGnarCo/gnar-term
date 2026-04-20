<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import RestoreCommandPrompt from "./RestoreCommandPrompt.svelte";
  import EmptySurface from "./EmptySurface.svelte";
  import type { Component } from "svelte";
  import type { Pane } from "../types";
  import {
    isTerminalSurface,
    isExtensionSurface,
    isPreviewSurface,
  } from "../types";
  import { surfaceTypeStore } from "../services/surface-type-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";

  export let pane: Pane;
  export let workspaceId: string = "";
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSelectSurfaceType: (typeId: string) => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onFocusPane: () => void;
  export let onReorderTab:
    | ((fromIdx: number, toIdx: number) => void)
    | undefined = undefined;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Notification chrome (Option E hybrid) ---
  // Persistent notify-colored border + corner pip while any surface in
  // this pane has hasUnread; one swell animation when an unread first
  // arrives. Cleared when the pane focuses (handleFocus below).
  $: paneHasUnread = pane.surfaces.some((s) => s.hasUnread);

  let arriving = false;
  let prevUnread = false;
  let arriveTimer: ReturnType<typeof setTimeout> | null = null;
  $: {
    if (paneHasUnread && !prevUnread) {
      arriving = true;
      if (arriveTimer) clearTimeout(arriveTimer);
      arriveTimer = setTimeout(() => {
        arriving = false;
      }, 1800);
    }
    prevUnread = paneHasUnread;
  }

  function clearUnreadInPane() {
    if (!paneHasUnread) return;
    workspaces.update((wsList) => {
      const ws = wsList.find((w) => w.id === workspaceId);
      if (!ws) return wsList;
      // Walk this pane's surfaces and clear hasUnread + notification text.
      // Touch only this pane — other panes (incl. background ones) keep
      // their unread state until the user lands on them.
      for (const s of pane.surfaces) {
        if (s.hasUnread) {
          s.hasUnread = false;
          s.notification = undefined;
        }
      }
      return [...wsList];
    });
  }

  function handleFocus() {
    onFocusPane();
    clearUnreadInPane();
  }

  function fitActiveTerminal() {
    const active = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (active && isTerminalSurface(active)) {
      try {
        active.fitAddon.fit();
      } catch (e) {
        console.warn("fitAddon.fit() failed on resize:", e);
      }
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
    if (arriveTimer) clearTimeout(arriveTimer);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={paneEl}
  data-unread={paneHasUnread ? "true" : undefined}
  data-arriving={arriving ? "true" : undefined}
  style="
    flex: 1; display: flex; flex-direction: column;
    min-width: 0; min-height: 0;
    position: relative;
    --notify: {$theme.notify};
    --notify-glow: {$theme.notifyGlow};
    border: 1px solid {paneHasUnread ? $theme.notify : $theme.border};
    border-radius: 4px; overflow: hidden;
    {paneHasUnread
    ? `box-shadow: 0 0 0 1px ${$theme.notifyGlow}, 0 0 14px 1px ${$theme.notifyGlow};`
    : ''}
    {arriving ? 'animation: paneNotifySwell 1.8s ease-out 1;' : ''}
  "
  on:mousedown={handleFocus}
>
  <TabBar
    {pane}
    {workspaceId}
    {onSelectSurface}
    {onCloseSurface}
    {onNewSurface}
    {onSelectSurfaceType}
    {onSplitRight}
    {onSplitDown}
    {onClosePane}
    {onReorderTab}
  />

  {#each pane.surfaces.filter((s) => s.id === pane.activeSurfaceId && isTerminalSurface(s)) as activeTerm (activeTerm.id)}
    {#if isTerminalSurface(activeTerm)}
      <RestoreCommandPrompt surface={activeTerm} />
    {/if}
  {/each}

  {#if paneHasUnread}
    <span
      aria-hidden="true"
      title="New activity in this pane"
      style="
        position: absolute;
        top: 6px; right: 6px;
        width: 7px; height: 7px;
        border-radius: 50%;
        background: {$theme.notify};
        box-shadow: 0 0 6px {$theme.notifyGlow};
        pointer-events: none;
        z-index: 5;
      "
    ></span>
  {/if}

  {#if pane.surfaces.length === 0}
    <!-- Empty pane view — the user just closed the last surface. Shows
         the same EmptySurface UX the app uses when every workspace has
         been closed, but scoped to this single empty pane. -->
    <EmptySurface />
  {/if}

  {#each pane.surfaces as surface (surface.id)}
    {#if isTerminalSurface(surface)}
      <TerminalSurface
        {surface}
        visible={surface.id === pane.activeSurfaceId}
        cwd={surface.cwd}
      />
    {:else if isExtensionSurface(surface)}
      {#each $surfaceTypeStore.filter((t) => t.id === surface.surfaceTypeId) as typeDef (typeDef.id)}
        {@const surfaceApi = getExtensionApiById(typeDef.source)}
        {#if surfaceApi}
          <ExtensionWrapper
            api={surfaceApi}
            component={typeDef.component}
            props={{ surface, visible: surface.id === pane.activeSurfaceId }}
          />
        {:else}
          <svelte:component
            this={typeDef.component as Component}
            {surface}
            visible={surface.id === pane.activeSurfaceId}
          />
        {/if}
      {/each}
    {:else if isPreviewSurface(surface)}
      <PreviewSurface {surface} visible={surface.id === pane.activeSurfaceId} />
    {/if}
  {/each}
</div>

<style>
  @keyframes paneNotifySwell {
    0% {
      box-shadow: 0 0 0 0 var(--notify-glow);
    }
    45% {
      box-shadow:
        0 0 0 2px var(--notify),
        0 0 22px 4px var(--notify);
    }
    100% {
      box-shadow:
        0 0 0 1px var(--notify-glow),
        0 0 14px 1px var(--notify-glow);
    }
  }
</style>
