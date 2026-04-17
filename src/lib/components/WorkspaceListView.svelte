<script lang="ts">
  /**
   * WorkspaceListView — renders a filtered list of WorkspaceItems
   * with full interaction support (click, close, rename, context menu)
   * and drag-to-reorder via the shared DragGrip.
   *
   * Used by extensions for scoped workspace lists in their own sidebar sections.
   * Reorder affects the global workspace order (the only source of truth);
   * within a filtered view, that translates to moving a workspace relative to
   * its visible peers.
   */
  import { flip } from "svelte/animate";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import { innerReorderActive } from "../stores/ui";
  import { createDragReorder } from "../actions/drag-reorder";
  import {
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    reorderWorkspaces,
  } from "../services/workspace-service";
  import WorkspaceItem from "./WorkspaceItem.svelte";

  /** Set of workspace IDs to display. If undefined, shows all. */
  export let filterIds: Set<string> | undefined = undefined;

  /** Project accent color passed to each WorkspaceItem for left-border coloring. */
  export let accentColor: string | undefined = undefined;

  $: entries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => (filterIds ? filterIds.has(ws.id) : true));

  let sourceIdx: number | null = null;
  let indicator: { idx: number; edge: "before" | "after" } | null = null;
  let active = false;

  const reorder = createDragReorder({
    dataAttr: "ws-view-drag-idx",
    containerSelector: ".workspace-list-view",
    ghostStyle: () => ({
      background: $theme.bgFloat ?? $theme.bgSurface ?? "#111",
      border: `1px solid ${accentColor ?? $theme.accent}`,
    }),
    onDrop: (from, to) => {
      // `from` and `to` are global workspace indices (encoded in the data
      // attribute below). reorderWorkspaces operates on the global list.
      reorderWorkspaces(from, to);
    },
    onStateChange: () => {
      const s = reorder.getState();
      sourceIdx = s.sourceIdx;
      indicator = s.indicator;
      active = s.active;
      innerReorderActive.set(s.active);
    },
  });

  function startDrag(e: MouseEvent, globalIdx: number) {
    reorder.start(e, globalIdx);
  }
</script>

<div class="workspace-list-view">
  {#each entries as entry (entry.ws.id)}
    <div animate:flip={{ duration: 200 }} data-ws-view-drag-idx={entry.idx}>
      {#if indicator?.idx === entry.idx && indicator.edge === "before"}
        <div
          style="height: 2px; background: {accentColor ??
            $theme.accent}; margin: 0 12px; border-radius: 1px;"
        ></div>
      {/if}
      <WorkspaceItem
        workspace={entry.ws}
        index={entry.idx}
        isActive={entry.idx === $activeWorkspaceIdx}
        dragActive={active && sourceIdx === entry.idx}
        {accentColor}
        onSelect={() => {
          if (!active) switchWorkspace(entry.idx);
        }}
        onClose={() => closeWorkspace(entry.idx)}
        onRename={(name) => renameWorkspace(entry.idx, name)}
        onContextMenu={() => {}}
        onGripMouseDown={(e) => startDrag(e, entry.idx)}
      />
      {#if indicator?.idx === entry.idx && indicator.edge === "after"}
        <div
          style="height: 2px; background: {accentColor ??
            $theme.accent}; margin: 0 12px; border-radius: 1px;"
        ></div>
      {/if}
    </div>
  {/each}

  {#if entries.length === 0}
    <div
      style="
        padding: 4px 12px; font-size: 10px;
        color: {$theme.fgDim}; font-style: italic;
      "
    >
      No workspaces
    </div>
  {/if}
</div>
