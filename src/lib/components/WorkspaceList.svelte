<script lang="ts">
  /**
   * WorkspaceList — renderer of the Workspaces section. Iterates the
   * unified `workspaceOrder` store and renders each `{kind:"workspace"}`
   * row as a GroupRow (an anchor + its nested members). OWNS the root
   * drag pipeline for the section — one createDragReorder reorders across
   * all anchor rows via `moveWorkspaceRow`. Member (nested) drags live in
   * MemberList and never bubble here.
   *
   * Renamed + simplified from dev's list block: the out-of-scope
   * non-workspace row kinds, the dashboard branch, the extension renderer
   * indirection (renders GroupRow directly), the archive-zone drop, and the
   * workspace-to-pane drop are all dropped. The collapsed-mode hover
   * popover (RESOLVED risk 4) is KEPT: a 150ms-grace popover portaled to
   * <body>, anchored at the hovered row's y, that renders the anchor row
   * at full width while the sidebar is collapsed.
   */
  import { onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import { sidebarVisible, sidebarWidth } from "../stores/ui";
  import { workspaceOrder, moveWorkspaceRow } from "../stores/workspace-order";
  import { createDragReorder, type DragReorderState } from "../actions/drag-reorder";
  import { portal } from "../actions/portal";
  import GroupRow from "./GroupRow.svelte";
  import DropGhost from "./DropGhost.svelte";
  import type { Workspace } from "../types";

  type RenderedRow = { id: string; idx: number; key: string; anchor: Workspace };

  // Map workspaceOrder rows → their anchor workspace. Rows whose referent
  // is missing are skipped (tolerates stale persisted entries). `idx` is
  // the position into $workspaceOrder (drag targets the store positions).
  $: renderedRows = $workspaceOrder
    .map((row, idx): RenderedRow | null => {
      if (row.kind !== "workspace") return null;
      const anchor = $workspaces.find((w) => w.id === row.id);
      if (!anchor) return null;
      return { id: row.id, idx, key: `${row.kind}:${row.id}`, anchor };
    })
    .filter((r): r is RenderedRow => r !== null);

  // --- Per-row popover (collapsed sidebar only) ---
  const POPOVER_GRACE_MS = 150;
  let popoverRow: { key: string; top: number } | null = null;
  let popoverGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let popoverEl: HTMLDivElement | null = null;
  const rowEls = new Map<string, HTMLDivElement>();

  function clearPopoverGraceTimer() {
    if (popoverGraceTimer) {
      clearTimeout(popoverGraceTimer);
      popoverGraceTimer = null;
    }
  }

  function setPopoverFromEvent(e: MouseEvent, key: string) {
    if ($sidebarVisible) return;
    clearPopoverGraceTimer();
    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    popoverRow = { key, top: rect.top };
  }

  function clearPopoverWithGrace() {
    if ($sidebarVisible) return;
    if (popoverGraceTimer) return;
    popoverGraceTimer = setTimeout(() => {
      popoverRow = null;
      popoverGraceTimer = null;
    }, POPOVER_GRACE_MS);
  }

  function pointInRect(x: number, y: number, el: HTMLElement | null): boolean {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function rowElRef(node: HTMLDivElement, key: string) {
    rowEls.set(key, node);
    return {
      destroy() {
        if (rowEls.get(key) === node) rowEls.delete(key);
      },
    };
  }

  function handleGlobalMouseMove(e: MouseEvent) {
    if (!popoverRow) return;
    const rowEl = rowEls.get(popoverRow.key) ?? null;
    const inside =
      pointInRect(e.clientX, e.clientY, popoverEl) ||
      pointInRect(e.clientX, e.clientY, rowEl);
    if (inside) clearPopoverGraceTimer();
    else clearPopoverWithGrace();
  }

  $: if (popoverRow && typeof document !== "undefined") {
    document.addEventListener("mousemove", handleGlobalMouseMove);
  } else if (typeof document !== "undefined") {
    document.removeEventListener("mousemove", handleGlobalMouseMove);
  }

  // Drop the popover whenever the sidebar expands mid-hover.
  $: if ($sidebarVisible && popoverRow) {
    clearPopoverGraceTimer();
    popoverRow = null;
  }

  onDestroy(() => {
    clearPopoverGraceTimer();
    if (typeof document !== "undefined") {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
    }
  });

  // --- Unified root drag pipeline ---
  let drag: DragReorderState = {
    sourceIdx: null,
    indicator: null,
    active: false,
    sourceHeight: 0,
  };

  const rootDrag = createDragReorder({
    dataAttr: "workspace-row-idx",
    containerSelector: "#sidebar",
    ghostStyle: () => ({
      background: "transparent",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    onDrop: (from, to) => moveWorkspaceRow(from, to),
    onStateChange: () => {
      drag = rootDrag.getState();
    },
  });

  function startRootRowDrag(e: MouseEvent, rowIdx: number) {
    const row = $workspaceOrder[rowIdx];
    if (row?.kind === "workspace") {
      const ws = $workspaces.find((w) => w.id === row.id);
      if (ws?.locked === true) return;
    }
    rootDrag.start(e, rowIdx);
  }

  $: sourceRow =
    drag.active && drag.sourceIdx !== null ? $workspaceOrder[drag.sourceIdx] : null;
  $: sourceAnchor = sourceRow
    ? ($workspaces.find((w) => w.id === sourceRow.id) ?? null)
    : null;
  $: sourceColor = sourceAnchor?.color ?? $theme.accent;
  $: sourceLabel = sourceAnchor?.name ?? "";

  // Anchor GroupRow refs keyed by anchor id so the Sidebar's ⇧⌘R
  // delegate can trigger an inline rename on the active anchor's row.
  let groupRefs: Record<string, GroupRow> = {};

  /** Start an inline rename on the workspace with this id, if it is an
   *  anchor row currently rendered. Members rename via their own row's
   *  context menu. */
  export function startRenameForWorkspace(id: string) {
    groupRefs[id]?.startRename?.();
  }
</script>

{#each renderedRows as entry (entry.key)}
  {@const isSource = drag.active && drag.sourceIdx === entry.idx}
  {@const ghostBefore =
    drag.indicator?.idx === entry.idx && drag.indicator?.edge === "before"}
  {@const ghostAfter =
    drag.indicator?.idx === entry.idx && drag.indicator?.edge === "after"}
  {#if ghostBefore}
    <div class="workspace-row">
      <DropGhost height={drag.sourceHeight} inset={4} accent={sourceColor} label={sourceLabel} />
    </div>
  {/if}
  {#if !isSource}
    <div class="workspace-row" data-workspace-row-container={entry.idx}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-workspace-row-idx={entry.idx}
        data-workspace-row-key={entry.key}
        style="position: relative;"
        on:mouseenter={(e) => setPopoverFromEvent(e, entry.key)}
        use:rowElRef={entry.key}
      >
        <GroupRow
          bind:this={groupRefs[entry.id]}
          anchor={entry.anchor}
          onGripMouseDown={(e) => startRootRowDrag(e, entry.idx)}
          popoverActive={popoverRow?.key === entry.key}
        />
      </div>
    </div>
  {/if}
  {#if ghostAfter}
    <div class="workspace-row">
      <DropGhost height={drag.sourceHeight} inset={4} accent={sourceColor} label={sourceLabel} />
    </div>
  {/if}
{/each}

{#if !$sidebarVisible && popoverRow}
  {@const popoverEntry = renderedRows.find((r) => r.key === popoverRow?.key)}
  {#if popoverEntry}
    <div
      bind:this={popoverEl}
      use:portal
      class="workspace-row-popover"
      data-workspace-row-popover={popoverEntry.key}
      style="
        position: fixed;
        top: {popoverRow.top}px;
        left: 4px;
        width: {$sidebarWidth - 4}px;
        z-index: 200;
        pointer-events: auto;
        background: transparent;
      "
    >
      <GroupRow anchor={popoverEntry.anchor} popoverActive={true} />
    </div>
  {/if}
{/if}

<style>
  .workspace-row + .workspace-row {
    margin-top: 8px;
  }
</style>
