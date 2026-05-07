<script lang="ts">
  import { rootRowOrder } from "../stores/root-row-order";
  import { workspaces, activeWorkspaceId } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import { activateWorkspace } from "../services/workspace-service";

  export let sidebarWidth: number;

  type Row = { id: string; name: string; color: string };

  let wrapperEl: HTMLElement;
  let stripEls: (HTMLElement | null)[] = [];
  let hoveredRow: Row | null = null;
  let bannerTop: number = 0;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  $: wsMap = new Map($workspaces.map((w) => [w.id, w]));

  $: rows = $rootRowOrder
    .filter((r) => r.kind === "workspace")
    .map((r) => {
      const ws = wsMap.get(r.id);
      return {
        id: r.id,
        name: ws?.name ?? r.id,
        color: ws?.color ?? $theme.accent,
      };
    });

  $: activeId = $activeWorkspaceId;

  function scheduleClose() {
    closeTimer = setTimeout(() => {
      hoveredRow = null;
      closeTimer = null;
    }, 80);
  }

  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function handleRailEnter(row: Row, idx: number) {
    cancelClose();
    hoveredRow = row;
    if (wrapperEl && stripEls[idx]) {
      const wrapperRect = wrapperEl.getBoundingClientRect();
      const stripRect = stripEls[idx]!.getBoundingClientRect();
      bannerTop = stripRect.top - wrapperRect.top;
    }
  }

  function handleClick(id: string) {
    void activateWorkspace(id);
  }
</script>

<div class="rail-wrapper" bind:this={wrapperEl}>
  <div class="rail-col">
    {#each rows as row, idx (row.id)}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div
        class="rail-strip"
        bind:this={stripEls[idx]}
        style="
          background: {row.color};
          opacity: {hoveredRow?.id === row.id || activeId === row.id ? 1 : 0.5};
        "
        on:mouseenter={() => handleRailEnter(row, idx)}
        on:mouseleave={scheduleClose}
        on:mousedown={() => handleClick(row.id)}
      />
    {/each}
  </div>

  {#if hoveredRow !== null}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="floating-banner"
      style="
        top: {bannerTop}px;
        width: {sidebarWidth - 8}px;
        background: {$theme.bgHighlight};
        border-left: 3px solid {hoveredRow.color};
        color: {$theme.fg};
      "
      on:mouseenter={cancelClose}
      on:mouseleave={scheduleClose}
      on:mousedown={() => handleClick(hoveredRow!.id)}
    >
      <span class="banner-name">{hoveredRow.name}</span>
    </div>
  {/if}
</div>

<style>
  .rail-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .rail-col {
    width: 100%;
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    gap: 4px;
    flex-shrink: 0;
  }

  .rail-strip {
    width: 100%;
    height: 32px;
    border-radius: 2px;
    cursor: pointer;
    transition: opacity 0.1s;
  }

  .floating-banner {
    position: absolute;
    left: 8px;
    height: 32px;
    display: flex;
    align-items: center;
    border-radius: 0 6px 6px 0;
    padding: 0 10px;
    cursor: pointer;
    z-index: 100;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.45);
  }

  .banner-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
