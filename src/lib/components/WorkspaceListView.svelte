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
  import { reorderContext, anyReorderActive } from "../stores/ui";
  import { createDragReorder } from "../actions/drag-reorder";
  import {
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    reorderWorkspaces,
  } from "../services/workspace-service";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import DropGhost from "./DropGhost.svelte";
  import { contrastColor } from "../utils/contrast";

  /** Set of workspace IDs to display. If undefined, shows all. */
  export let filterIds: Set<string> | undefined = undefined;

  /** Project accent color passed to each WorkspaceItem for left-border coloring. */
  export let accentColor: string | undefined = undefined;

  /**
   * The immediate container ("scope") this list's workspaces live in — a
   * project id when rendered inside a project scope, otherwise
   * "__workspaces__". Published to `reorderContext` as `scopeId` during a
   * drag so the sidebar's overlay layer knows which project is the source.
   */
  export let scopeId: string | null = null;

  /**
   * The top-level sidebar block id that hosts this list. Used to render
   * block-level dims for non-source blocks during a workspace drag from
   * here.
   */
  export let containerBlockId: string | null = null;

  $: entries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => (filterIds ? filterIds.has(ws.id) : true));

  let sourceIdx: number | null = null;
  let indicator: { idx: number; edge: "before" | "after" } | null = null;
  let active = false;
  let sourceHeight = 0;

  const reorder = createDragReorder({
    dataAttr: "ws-view-drag-idx",
    containerSelector: ".workspace-list-view",
    canStart: () => !$anyReorderActive,
    ghostStyle: () => ({
      background: $theme.bgFloat ?? $theme.bgSurface ?? "#111",
      border: `1px solid ${$theme.border ?? "transparent"}`,
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
      sourceHeight = s.sourceHeight;
      if (s.active && scopeId && containerBlockId) {
        reorderContext.set({
          kind: "workspace",
          scopeId,
          containerBlockId,
        });
      } else {
        reorderContext.set(null);
      }
    },
  });

  function startDrag(e: MouseEvent, globalIdx: number) {
    reorder.start(e, globalIdx);
  }

  // Source metadata used for the DropGhost label + non-source
  // overlay color so the drag feedback matches the root-level style
  // (project + workspace rows show their own tile with name centered).
  $: sourceWs =
    active && sourceIdx !== null
      ? ($workspaces.find((w, i) => i === sourceIdx) ?? null)
      : null;
  $: railColor = accentColor ?? $theme.accent;
  $: overlayFg = contrastColor(railColor);
</script>

<div class="workspace-list-view">
  {#each entries as entry (entry.ws.id)}
    {@const isSrc = active && sourceIdx === entry.idx}
    {@const isSibling = active && sourceIdx !== entry.idx}
    <div
      class="workspace-list-row"
      animate:flip={{ duration: 200 }}
      data-ws-view-drag-idx={entry.idx}
    >
      {#if indicator?.idx === entry.idx && indicator.edge === "before"}
        <DropGhost
          theme={$theme}
          height={sourceHeight}
          accent={railColor}
          label={sourceWs?.name}
        />
      {/if}
      <div style="position: relative;">
        <WorkspaceItem
          workspace={entry.ws}
          index={entry.idx}
          isActive={entry.idx === $activeWorkspaceIdx}
          dragActive={isSrc}
          {accentColor}
          onSelect={() => {
            if (!active) switchWorkspace(entry.idx);
          }}
          onClose={() => closeWorkspace(entry.idx)}
          onRename={(name) => renameWorkspace(entry.idx, name)}
          onContextMenu={() => {}}
          onGripMouseDown={(e) => startDrag(e, entry.idx)}
        />
        {#if isSibling}
          <!-- Strong overlay on non-source nested rows during drag —
               matches the root-level drag treatment so a nested
               reorder reads identically to a root reorder. -->
          <div
            aria-hidden="true"
            style="
              position: absolute; inset: 0;
              background: {railColor}; color: {overlayFg};
              display: flex; align-items: center; justify-content: center;
              font-size: 13px; font-weight: 600;
              pointer-events: none;
              z-index: 3;
              border-radius: 0 6px 6px 0;
              margin-right: 8px;
            "
          >
            {entry.ws.name}
          </div>
        {/if}
      </div>
      {#if indicator?.idx === entry.idx && indicator.edge === "after"}
        <DropGhost
          theme={$theme}
          height={sourceHeight}
          accent={railColor}
          label={sourceWs?.name}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  /* Gap between adjacent workspace rows so the rail reads as a stack
     of discrete workspace tiles rather than one unbroken column.
     Matched by WorkspaceListBlock's .root-row + rule so root and
     nested workspace lists have identical vertical rhythm. */
  .workspace-list-row + .workspace-list-row {
    margin-top: 6px;
  }
  /* 8px left + top margin on the nested list so the workspace rails
     sit visually inset from the parent project's rail and the first
     nested row breathes below the project banner. WorkspaceItem
     itself has no margin (root workspaces are flush); we apply the
     inset here so it only fires in the nested context. */
  .workspace-list-view {
    margin-left: 8px;
    margin-top: 8px;
  }
</style>
