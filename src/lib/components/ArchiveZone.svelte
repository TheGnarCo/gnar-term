<!-- src/lib/components/ArchiveZone.svelte -->
<script lang="ts">
  import { contextMenu, showConfirmPrompt } from "../stores/ui";
  import { theme } from "../stores/theme";
  import { archivedOrder, archivedDefs } from "../stores/archive";
  import { unarchiveWorkspace } from "../services/archive-service";
  let expanded = false;
  let archiveZoneEl: HTMLElement | null = null;
  let hoveredRowId: string | null = null;
  let headerHovered = false;

  $: totalCount = $archivedOrder.length;

  function toggle() {
    expanded = !expanded;
  }

  function getName(id: string): string {
    return $archivedDefs.workspaces[id]?.workspace.name ?? id;
  }

  async function confirmAndUnarchive(id: string) {
    const confirmed = await showConfirmPrompt(
      `Unarchive "${getName(id)}" and restore its branches?`,
      { confirmLabel: "Unarchive" },
    );
    if (!confirmed) return;
    void unarchiveWorkspace(id);
  }

  function showItemContextMenu(x: number, y: number, id: string) {
    contextMenu.set({
      x,
      y,
      items: [
        {
          label: "Unarchive",
          action: () => void confirmAndUnarchive(id),
        },
      ],
    });
  }

  // Drag-out state
  let draggingId: string | null = null;
  let ghostEl: HTMLElement | null = null;

  function startItemDrag(e: MouseEvent, id: string) {
    if (e.button !== 0) return;
    draggingId = id;

    ghostEl = document.createElement("div");
    ghostEl.textContent = getName(id);
    Object.assign(ghostEl.style, {
      position: "fixed",
      pointerEvents: "none",
      background: "rgba(30,30,30,0.9)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: "4px",
      padding: "4px 10px",
      fontSize: "12px",
      color: "#aaa",
      fontStyle: "italic",
      zIndex: "9999",
      left: `${e.clientX + 8}px`,
      top: `${e.clientY - 12}px`,
    });
    document.body.appendChild(ghostEl);

    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e: MouseEvent) {
    if (!ghostEl) return;
    ghostEl.style.left = `${e.clientX + 8}px`;
    ghostEl.style.top = `${e.clientY - 12}px`;
  }

  function onDragEnd(e: MouseEvent) {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    ghostEl?.remove();
    ghostEl = null;

    if (!draggingId) return;
    const id = draggingId;
    draggingId = null;

    const archiveEl = document.querySelector("[data-archive-zone]");
    if (archiveEl) {
      const rect = archiveEl.getBoundingClientRect();
      const overZone =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!overZone) void unarchiveWorkspace(id);
    }
  }
</script>

<!-- The archive section sits at the bottom of the sidebar (outside the
     scrollable content) so it stays visible as a drop target. Inner
     padding-left of 4px matches the scrollable content's left inset so
     the row chrome lines up with the workspace rows above. -->
<div data-archive-zone class="archive-zone" bind:this={archiveZoneEl}>
  <button
    type="button"
    on:click={toggle}
    on:mouseenter={() => (headerHovered = true)}
    on:mouseleave={() => (headerHovered = false)}
    data-archive-header
    aria-expanded={expanded}
    class="archive-banner"
    style="
      background: {headerHovered
      ? $theme.bgHighlight
      : ($theme.bgSurface ?? 'transparent')};
      color: {$theme.fg};
    "
  >
    <div
      aria-hidden="true"
      class="rail-border"
      style="border-color: {$theme.fgDim};"
    ></div>
    <div class="archive-banner-body">
      <span class="archive-label">Archive</span>
      <span
        aria-hidden="true"
        class="expand-chip"
        style="background: {$theme.bgSurface ?? 'transparent'};"
      >
        {#if totalCount > 0 && !expanded}
          <span class="expand-count" style="color: {$theme.fgDim};"
            >{totalCount}</span
          >
        {/if}
        <svg
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          stroke={$theme.fgDim}
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="transition: transform 0.2s ease; transform: rotate({expanded
            ? 0
            : 180}deg);"
        >
          <polyline points="1,1 6,7 11,1" />
        </svg>
      </span>
    </div>
  </button>

  {#if expanded}
    <div class="archive-list">
      {#if totalCount === 0}
        <div class="empty-hint">drag here to archive</div>
      {:else}
        {#each $archivedOrder as id (id)}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="archive-item"
            on:mouseenter={() => (hoveredRowId = id)}
            on:mouseleave={() => (hoveredRowId = null)}
            on:contextmenu|preventDefault={(e) =>
              showItemContextMenu(e.clientX, e.clientY, id)}
            on:mousedown={(e) => startItemDrag(e, id)}
            style="
              background: {hoveredRowId === id
              ? $theme.bgHighlight
              : ($theme.bgSurface ?? 'transparent')};
              color: {$theme.fg};
            "
          >
            <div
              aria-hidden="true"
              class="rail-border"
              style="border-color: {$theme.fgDim};"
            ></div>
            <span class="item-name">{getName(id)}</span>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .archive-zone {
    flex-shrink: 0;
    position: relative;
    padding: 8px 0 8px 4px;
  }

  .archive-banner {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: stretch;
    min-height: 32px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 6px;
    position: relative;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    overflow: hidden;
    transition: background 0.1s;
  }

  .rail-border {
    position: absolute;
    inset: 0;
    border: 3px solid;
    border-radius: 6px;
    opacity: 0.35;
    pointer-events: none;
    box-sizing: border-box;
  }

  .archive-banner-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
  }

  .archive-label {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expand-chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 24px;
    min-width: 28px;
    padding: 0 6px;
    border-radius: 5px;
  }

  .expand-count {
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
  }

  .archive-list {
    margin-top: 2px;
    max-height: 160px;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .empty-hint {
    padding: 6px 10px 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.2);
    font-style: italic;
    text-align: center;
  }

  .archive-item {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    min-height: 32px;
    border-radius: 6px;
    position: relative;
    overflow: hidden;
    user-select: none;
    cursor: grab;
    transition: background 0.1s;
  }

  .item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    padding: 4px 6px;
    font-size: 13px;
  }
</style>
