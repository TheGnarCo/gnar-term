<!-- src/lib/components/ArchiveZone.svelte -->
<script lang="ts">
  import {
    contextMenu,
    anyReorderActive,
    metaPreviewActive,
    showConfirmPrompt,
  } from "../stores/ui";
  import { theme } from "../stores/theme";
  import {
    archivedOrder,
    archivedDefs,
    type ArchivedRow,
  } from "../stores/archive";
  import { unarchiveWorkspace } from "../services/archive-service";
  import DragGrip from "./DragGrip.svelte";

  let expanded = false;
  let archiveZoneEl: HTMLElement | null = null;
  let hoveredRowKey: string | null = null;

  function rowKey(row: ArchivedRow): string {
    return `${row.kind}:${row.id}`;
  }

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

  function getName(row: ArchivedRow): string {
    if (row.kind === "workspace") {
      return $archivedDefs.nestedWorkspaces[row.id]?.def.name ?? row.id;
    }
    return $archivedDefs.groups[row.id]?.group.name ?? row.id;
  }

  function getGroupWorkspaceCount(id: string): number {
    return $archivedDefs.groups[id]?.workspaceDefs.length ?? 0;
  }

  async function confirmAndUnarchive(row: ArchivedRow) {
    const name = getName(row);
    const isGroup = row.kind === "workspace-group";
    const message = isGroup
      ? `Unarchive "${name}" and restore its nestedWorkspaces?`
      : `Unarchive "${name}"?`;
    const confirmed = await showConfirmPrompt(message, {
      confirmLabel: "Unarchive",
    });
    if (!confirmed) return;
    if (row.kind === "workspace-group") void unarchiveWorkspace(row.id);
  }

  function showItemContextMenu(x: number, y: number, row: ArchivedRow) {
    contextMenu.set({
      x,
      y,
      items: [
        {
          label: "Unarchive",
          action: () => void confirmAndUnarchive(row),
        },
      ],
    });
  }

  // Drag-out state
  let draggingRow: ArchivedRow | null = null;
  let ghostEl: HTMLElement | null = null;

  function startItemDrag(e: MouseEvent, row: ArchivedRow) {
    if (e.button !== 0) return;
    draggingRow = row;

    ghostEl = document.createElement("div");
    ghostEl.textContent = getName(row);
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

    if (!draggingRow) return;
    const row = draggingRow;
    draggingRow = null;

    const archiveEl = document.querySelector("[data-archive-zone]");
    if (archiveEl) {
      const rect = archiveEl.getBoundingClientRect();
      const overZone =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!overZone) {
        if (row.kind === "workspace-group") void unarchiveWorkspace(row.id);
      }
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
        {#each $archivedOrder as row (`${row.kind}:${row.id}`)}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="archive-item"
            on:mouseenter={() => (hoveredRowKey = rowKey(row))}
            on:mouseleave={() => (hoveredRowKey = null)}
            on:contextmenu|preventDefault={(e) =>
              showItemContextMenu(e.clientX, e.clientY, row)}
            on:mousedown={(e) => startItemDrag(e, row)}
          >
            <DragGrip
              theme={$theme}
              visible={hoveredRowKey === rowKey(row)}
              railOpacity={0.35}
            />
            {#if row.kind === "workspace-group"}
              <span class="item-name"
                >{getName(row)} ({getGroupWorkspaceCount(row.id)})</span
              >
            {:else}
              <span class="item-name">{getName(row)}</span>
            {/if}
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
