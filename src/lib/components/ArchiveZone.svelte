<!-- src/lib/components/ArchiveZone.svelte -->
<script lang="ts">
  import {
    contextMenu,
    anyReorderActive,
    showConfirmPrompt,
  } from "../stores/ui";
  import { theme } from "../stores/theme";
  import { archivedOrder, archivedDefs } from "../stores/archive";
  import { unarchiveWorkspace } from "../services/archive-service";
  import DragGrip from "./DragGrip.svelte";

  let expanded = false;
  // True when the current expanded state was triggered by a drag entering
  // the zone, NOT by a user click. The reorder-end watcher only collapses
  // back when the open state was auto-driven — manual user toggles persist.
  let autoExpanded = false;
  let archiveZoneEl: HTMLElement | null = null;
  let hoveredRowId: string | null = null;
  let headerHovered = false;

  $: totalCount = $archivedOrder.length;

  function toggle() {
    expanded = !expanded;
    autoExpanded = false;
  }

  // Drag-hover auto-expand: while a sidebar drag is active and the cursor
  // enters the archive zone, expand it so the user can see what sits
  // inside (and where their item lands). Replaces the older Meta-hold
  // preview overlay — the expansion itself is the discoverability cue.
  function onZoneEnter() {
    if ($anyReorderActive && !expanded) {
      expanded = true;
      autoExpanded = true;
    }
  }

  // When the drag ends, collapse back if (and only if) we auto-expanded.
  $: if (!$anyReorderActive && autoExpanded) {
    expanded = false;
    autoExpanded = false;
  }

  function getName(id: string): string {
    return $archivedDefs.workspaces[id]?.workspace.name ?? id;
  }

  function getBranchCount(id: string): number {
    return $archivedDefs.workspaces[id]?.childWorkspaceDefs.length ?? 0;
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
    on:mouseenter={() => {
      headerHovered = true;
      onZoneEnter();
    }}
    on:mouseleave={() => (headerHovered = false)}
    data-archive-header
    aria-expanded={expanded}
    style="
      width: 100%;
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      margin: 0 8px 0 0;
      padding: 0 12px 0 0;
      background: {headerHovered
      ? ($theme.bgHighlight ?? 'rgba(255,255,255,0.05)')
      : 'transparent'};
      border: 1px solid {$theme.border ?? 'transparent'};
      border-radius: 0 6px 6px 0;
      cursor: pointer;
      color: rgba(255, 255, 255, 0.55);
      font-family: inherit;
      font-size: 13px;
      transition: background 0.1s;
    "
  >
    <DragGrip
      theme={$theme}
      visible={false}
      railColor={$theme.fgDim}
      railOpacity={0.35}
    />
    <span
      aria-hidden="true"
      style="
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        color: inherit;
        transition: transform 0.15s ease;
        transform: rotate({expanded ? 90 : 0}deg);
      "
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="3,2 8,6 3,10" />
      </svg>
    </span>
    <span style="flex: 1; text-align: left;">Archive</span>
    {#if totalCount > 0}
      <span
        style="
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.55);
          border-radius: 3px;
          padding: 1px 5px;
          font-size: 10px;
          font-weight: 600;
        "
      >
        {totalCount}
      </span>
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
            <span class="item-name">{getName(id)} ({getBranchCount(id)})</span>
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
    /* 4px left inset matches the scrollable content's
       `padding: 8px 0 8px 4px` so the archive row's rail aligns with the
       workspace rows above it. 8px top breathing room mirrors the
       scrollable area's vertical inset. */
    padding: 8px 0 8px 4px;
  }

  .archive-list {
    margin-top: 2px;
    max-height: 160px;
    overflow-y: auto;
    padding: 0 8px 0 0;
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
