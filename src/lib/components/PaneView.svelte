<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import DiffView from "./DiffView.svelte";
  import FileBrowserView from "./FileBrowserView.svelte";
  import CommitHistoryView from "./CommitHistoryView.svelte";
  import HarnessPlaceholder from "./HarnessPlaceholder.svelte";
  import type { Pane } from "../types";
  import {
    isTerminalSurface,
    isPreviewSurface,
    isHarnessSurface,
    isDiffSurface,
    isFileBrowserSurface,
    isCommitHistorySurface,
    isHarnessPlaceholderSurface,
  } from "../types";

  export let pane: Pane;
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onNewHarnessSurface: ((presetId: string) => void) | undefined =
    undefined;
  export let onSwitchSurface:
    | ((kind: string, presetId?: string) => void)
    | undefined = undefined;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onFocusPane: () => void;
  export let onRenameTab:
    | ((surfaceId: string, newTitle: string) => void)
    | undefined = undefined;
  export let onReorderTab:
    | ((fromIdx: number, toIdx: number) => void)
    | undefined = undefined;
  export let onRelaunchHarness: ((surfaceId: string) => void) | undefined =
    undefined;
  export let worktreePath: string | undefined = undefined;
  export let onNewContextualSurface: ((kind: string) => void) | undefined =
    undefined;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  function fitActiveTerminal() {
    const active = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (active && (isTerminalSurface(active) || isHarnessSurface(active))) {
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
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={paneEl}
  style="
    flex: 1; display: flex; flex-direction: column;
    min-width: 0; min-height: 0;
    border: none;
    border-radius: 0; overflow: hidden;
  "
  on:mousedown={onFocusPane}
>
  <TabBar
    {pane}
    {onSelectSurface}
    {onCloseSurface}
    {onNewSurface}
    {onNewHarnessSurface}
    {onSwitchSurface}
    {onSplitRight}
    {onSplitDown}
    {onClosePane}
    {onRenameTab}
    {onReorderTab}
    {worktreePath}
    {onNewContextualSurface}
  />

  {#each pane.surfaces as surface (surface.id)}
    {#if isTerminalSurface(surface)}
      <TerminalSurface
        {surface}
        visible={surface.id === pane.activeSurfaceId}
        cwd={surface.cwd}
      />
    {:else if isHarnessSurface(surface)}
      <TerminalSurface
        {surface}
        visible={surface.id === pane.activeSurfaceId}
        cwd={surface.cwd}
      />
    {:else if isPreviewSurface(surface)}
      <PreviewSurface {surface} visible={surface.id === pane.activeSurfaceId} />
    {:else if isDiffSurface(surface)}
      <DiffView {surface} visible={surface.id === pane.activeSurfaceId} />
    {:else if isFileBrowserSurface(surface)}
      <FileBrowserView
        {surface}
        visible={surface.id === pane.activeSurfaceId}
      />
    {:else if isCommitHistorySurface(surface)}
      <CommitHistoryView
        {surface}
        visible={surface.id === pane.activeSurfaceId}
      />
    {:else if isHarnessPlaceholderSurface(surface)}
      <HarnessPlaceholder
        {surface}
        visible={surface.id === pane.activeSurfaceId}
        onRelaunch={() => onRelaunchHarness?.(surface.id)}
      />
    {/if}
  {/each}
</div>
