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
  import { get } from "svelte/store";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import DropGhost from "./DropGhost.svelte";
  import { contrastColor } from "../utils/contrast";
  import { contextMenu } from "../stores/ui";
  import { commandStore } from "../services/command-registry";
  import type { MenuItem } from "../context-menu-types";

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

  /**
   * Human-readable name of the scope this list lives in — e.g. the
   * project name for workspaces nested under a project. Surfaces in the
   * context menu's "Close Other Workspaces in <label>…" item so the
   * action's blast radius is obvious at a glance. Leave undefined and
   * the menu falls back to the global "Close Other Workspaces" label
   * with no scoping.
   */
  export let containerLabel: string | undefined = undefined;

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

  let itemRefs: Record<string, WorkspaceItem> = {};

  // Nested workspaces share the same context menu surface as the root
  // workspace list: Rename / New Surface / (Promote) / Close Other /
  // Close. Rename drives the underlying WorkspaceItem's inline rename
  // via the bound ref; everything else routes through the workspace
  // service. Kept local to WorkspaceListView so this shared component
  // doesn't need parent callbacks for each item.
  function showNestedContextMenu(x: number, y: number, globalIdx: number) {
    const ws = $workspaces[globalIdx];
    if (!ws) return;
    const canPromote = get(commandStore).some(
      (c) => c.id === "promote-workspace-to-project",
    );

    // Scope "Close Other" to this list when a filterIds is in effect
    // (i.e. we're rendered under a project/dashboard). Without a filter
    // the list is the global root, so "Close Other" closes every other
    // workspace in the app. With one, it only closes the visible peers
    // so the user doesn't accidentally nuke other projects' workspaces.
    const siblingIds = filterIds
      ? Array.from(filterIds).filter((id) => id !== ws.id)
      : $workspaces
          .map((w, i) => (i === globalIdx ? null : w.id))
          .filter((id): id is string => !!id);
    const closeOtherLabel = containerLabel
      ? `Close Other Workspaces in ${containerLabel}`
      : "Close Other Workspaces";

    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        shortcut: "⇧⌘R",
        action: () => itemRefs[ws.id]?.startRename(),
      },
      ...(canPromote
        ? [
            { label: "", action: () => {}, separator: true } as MenuItem,
            {
              label: "Promote to Project...",
              action: () => {
                switchWorkspace(globalIdx);
                const cmd = get(commandStore).find(
                  (c) => c.id === "promote-workspace-to-project",
                );
                if (cmd) void cmd.action();
              },
            } as MenuItem,
          ]
        : []),
      { label: "", action: () => {}, separator: true },
      {
        label: closeOtherLabel,
        disabled: siblingIds.length === 0,
        action: () => {
          // Walk back-to-front so indices stay valid as we splice. Map
          // siblingIds → current indices just before closing; the list
          // doesn't mutate mid-loop in a way that invalidates the stable
          // id snapshot we captured above.
          const targets = siblingIds
            .map((id) => $workspaces.findIndex((w) => w.id === id))
            .filter((i) => i >= 0)
            .sort((a, b) => b - a);
          for (const i of targets) closeWorkspace(i);
        },
      },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: $workspaces.length <= 1,
        action: () => closeWorkspace(globalIdx),
      },
    ];
    contextMenu.set({ x, y, items });
  }
</script>

<!-- Skip the whole container when the filtered list is empty. The
     class applies an 8px top+left inset so nested rows breathe below
     the banner — rendering an empty container with that inset leaves
     a visible "lip" on the parent's colored rail (project row with no
     workspaces, dashboard row with no worktrees). Guarding here keeps
     the rail flush. -->
{#if entries.length > 0}
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
            bind:this={itemRefs[entry.ws.id]}
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
            onContextMenu={(x, y) => showNestedContextMenu(x, y, entry.idx)}
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
{/if}

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
