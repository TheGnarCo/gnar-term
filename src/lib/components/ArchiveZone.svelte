<!-- src/lib/components/ArchiveZone.svelte -->
<script lang="ts">
  import {
    contextMenu,
    anyReorderActive,
    metaPreviewActive,
    showConfirmPrompt,
  } from "../stores/ui";
  import { theme } from "../stores/theme";
  import { archivedOrder, archivedDefs } from "../stores/archive";
  import { unarchiveWorkspace } from "../services/archive-service";
  import DragGrip from "./DragGrip.svelte";

  let expanded = false;
  let archiveZoneEl: HTMLElement | null = null;
  let hoveredRowId: string | null = null;

  let metaPreviewTimer: ReturnType<typeof setTimeout> | null = null;

  function activateMetaPreview() {
    archiveZoneEl?.setAttribute("data-drag-preview", "true");
    metaPreviewActive.set(true);
  }
  function deactivateMetaPreview() {
    if (metaPreviewTimer !== null) {
      clearTimeout(metaPreviewTimer);
      metaPreviewTimer = null;
    }
    archiveZoneEl?.removeAttribute("data-drag-preview");
    metaPreviewActive.set(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Meta" && metaPreviewTimer === null) {
      metaPreviewTimer = setTimeout(activateMetaPreview, 600);
    }
  }
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === "Meta") deactivateMetaPreview();
  }
  function onBlur() {
    deactivateMetaPreview();
  }

  $: if (archiveZoneEl) {
    if ($anyReorderActive)
      archiveZoneEl.setAttribute("data-drag-active", "true");
    else archiveZoneEl.removeAttribute("data-drag-active");
  }

  $: totalCount = $archivedOrder.length;

  function toggle() {
    expanded = !expanded;
  }

  function getName(id: string): string {
    return $archivedDefs.workspaces[id]?.workspace.name ?? id;
  }

  function getNestedCount(id: string): number {
    return $archivedDefs.workspaces[id]?.nestedWorkspaceDefs.length ?? 0;
  }

  async function confirmAndUnarchive(id: string) {
    const confirmed = await showConfirmPrompt(
      `Unarchive "${getName(id)}" and restore its nested workspaces?`,
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

<svelte:window on:keydown={onKeyDown} on:keyup={onKeyUp} on:blur={onBlur} />

<div data-archive-zone class="archive-zone" bind:this={archiveZoneEl}>
  <button
    type="button"
    on:click={toggle}
    class="archive-header"
    class:has-items={totalCount > 0}
  >
    <svg
      aria-hidden="true"
      width="12"
      height="8"
      viewBox="0 0 12 8"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      style="transition: transform 0.2s ease; transform: rotate({expanded
        ? 0
        : 180}deg);"><polyline points="1,1 6,7 11,1" /></svg
    >
    <span>Archive</span>
    {#if totalCount > 0}
      <span class="badge">{totalCount}</span>
    {/if}
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
          >
            <DragGrip
              theme={$theme}
              visible={hoveredRowId === id}
              railOpacity={0.35}
            />
            <span class="item-name">{getName(id)} ({getNestedCount(id)})</span>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .archive-zone {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    position: relative;
  }

  .archive-zone:global([data-drag-over])::after,
  .archive-zone:global([data-drag-preview])::after,
  .archive-zone:global([data-drag-active])::after {
    content: "Archive";
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: rgba(55, 55, 55, 0.93);
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    z-index: 10;
    pointer-events: none;
    border-radius: 4px;
  }

  .archive-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.35);
  }

  .archive-header.has-items {
    color: rgba(255, 255, 255, 0.55);
  }

  .badge {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.35);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
  }

  .archive-list {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    max-height: 160px;
    overflow-y: auto;
    padding-bottom: 8px;
  }

  .empty-hint {
    padding: 6px 10px 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.2);
    font-style: italic;
    text-align: center;
  }

  .archive-item {
    padding: 4px 10px 4px 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
    display: flex;
    align-items: center;
    user-select: none;
    cursor: grab;
    gap: 4px;
  }

  .item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
