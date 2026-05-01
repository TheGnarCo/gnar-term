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
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
  } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import { getAllSurfaces } from "../types";
  import { tabDragState } from "../services/tab-drag";
  import { reorderContext, anyReorderActive } from "../stores/ui";
  import { createDragReorder } from "../actions/drag-reorder";
  import {
    detectWorkspacePaneDrop,
    detectTabBarDropForWorkspace,
    setWorkspaceDragState,
    createDragDenyOverlay,
    removeDragDenyOverlay,
    type WorkspacePaneDropTarget,
  } from "../services/workspace-drag";
  import {
    expandWorkspaceIntoPanes,
    mergeWorkspaceIntoPane,
  } from "../services/pane-service";
  import {
    switchNestedWorkspace,
    renameNestedWorkspace,
    reorderWorkspaces,
    toggleWorkspaceLock,
  } from "../services/workspace-service";
  import { get } from "svelte/store";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import DropGhost from "./DropGhost.svelte";
  import { contrastColor } from "../utils/contrast";
  import { contextMenu } from "../stores/ui";
  import { confirmAndCloseWorkspace } from "../services/worktree-service";
  import { commandStore } from "../services/command-registry";
  import { dashboardWorkspaceRegistry } from "../services/dashboard-workspace-service";
  import { buildWorkspaceContextMenuItems } from "../utils/workspace-context-menu";
  import { wsMeta } from "../services/service-helpers";

  /** Set of workspace IDs to display. If undefined, shows all. */
  export let filterIds: Set<string> | undefined = undefined;

  /** Project accent color passed to each WorkspaceItem for left-border coloring. */
  export let accentColor: string | undefined = undefined;

  /**
   * Optional per-workspace dashboard hint provider. When set, each rendered
   * WorkspaceItem receives the result as its `dashboardHint` prop — a small
   * clickable dashboard icon whose handler the caller owns. Used by
   * AgentDashboardRow to navigate back to a nested workspace's owning
   * dashboard without selecting the workspace.
   */
  export let dashboardHintFor:
    | ((
        ws: import("../types").NestedWorkspace,
      ) => { id: string; color?: string; onClick: () => void } | undefined)
    | undefined = undefined;
  /**
   * Forwarded to every WorkspaceItem. When true, per-row unread/agent
   * badges and the latest-notification row are suppressed — the caller
   * aggregates that status at the container level (e.g. AgentDashboardRow
   * banner).
   */
  export let hideStatusBadges: boolean = false;

  /**
   * The immediate container ("scope") this list's nestedWorkspaces live in — a
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
   * Human-readable name of the scope this list lives in. The "Close
   * Other Workspaces" menu item was removed, so the label is currently
   * unused inside WorkspaceListView — retained on the prop surface so
   * callers (ContainerRow) don't have to rewire when a future action
   * needs the label.
   */
  export let containerLabel: string | undefined = undefined;
  void containerLabel;

  $: allEntries = $nestedWorkspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => (filterIds ? filterIds.has(ws.id) : true));

  $: entries = allEntries.filter(({ ws }) => wsMeta(ws).isDashboard !== true);

  $: isNested = scopeId !== null;

  let sourceIdx: number | null = null;
  let indicator: { idx: number; edge: "before" | "after" } | null = null;
  let active = false;
  let sourceHeight = 0;
  let currentPaneTarget: WorkspacePaneDropTarget = null;

  const reorder = createDragReorder({
    dataAttr: "ws-view-drag-idx",
    containerSelector: ".workspace-list-view",
    canStart: () => !$anyReorderActive,
    ghostStyle: () => ({
      background: "transparent",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    onDrop: (from, to) => {
      // `from` and `to` are global workspace indices (encoded in the data
      // attribute below). reorderWorkspaces operates on the global list.
      reorderWorkspaces(from, to);
    },
    onMove: (x, y, ghostEl) => {
      if (sourceIdx === null) return;
      const srcWsId = $nestedWorkspaces[sourceIdx]?.id;
      if (!srcWsId) return;
      // Tab bar takes precedence over pane body.
      const tabTarget = detectTabBarDropForWorkspace(x, y, srcWsId);
      currentPaneTarget = tabTarget ?? detectWorkspacePaneDrop(x, y, srcWsId);
      setWorkspaceDragState(
        currentPaneTarget !== null
          ? { workspaceId: srcWsId, dropTarget: currentPaneTarget }
          : null,
      );
      if (ghostEl) {
        if (currentPaneTarget?.kind === "deny") {
          createDragDenyOverlay(ghostEl);
        } else {
          removeDragDenyOverlay(ghostEl);
        }
      }
    },
    onDragCommit: (fromIdx) => {
      const paneTarget = currentPaneTarget;
      currentPaneTarget = null;
      setWorkspaceDragState(null);
      const srcWsId = $nestedWorkspaces[fromIdx]?.id;
      if (paneTarget?.kind === "pane-split" && srcWsId) {
        const direction =
          paneTarget.zone === "left" || paneTarget.zone === "right"
            ? "horizontal"
            : "vertical";
        const before = paneTarget.zone === "left" || paneTarget.zone === "top";
        expandWorkspaceIntoPanes(srcWsId, paneTarget.paneId, direction, before);
      } else if (paneTarget?.kind === "tab-merge" && srcWsId) {
        mergeWorkspaceIntoPane(srcWsId, paneTarget.paneId);
      }
      // Return true to suppress sidebar reorder when a pane target was active.
      return paneTarget !== null;
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
      if (!s.active) {
        currentPaneTarget = null;
        setWorkspaceDragState(null);
      }
    },
  });

  function startDrag(e: MouseEvent, globalIdx: number) {
    // Locked nestedWorkspaces refuse drag-start. canStart in createDragReorder
    // fires before sourceIdx is populated, so we gate here instead.
    const ws = $nestedWorkspaces[globalIdx];
    if (ws && wsMeta(ws).locked === true) return;
    reorder.start(e, globalIdx);
  }

  // Source metadata used for the DropGhost label + non-source
  // overlay color so the drag feedback matches the root-level style
  // (project + workspace rows show their own tile with name centered).
  $: sourceWs =
    active && sourceIdx !== null
      ? ($nestedWorkspaces.find((w, i) => i === sourceIdx) ?? null)
      : null;
  $: railColor = accentColor ?? $theme.accent;
  $: overlayFg = contrastColor(railColor);
  $: dropAccent = (() => {
    const id = sourceWs
      ? wsMeta(sourceWs).dashboardNestedWorkspaceId
      : undefined;
    if (typeof id === "string") {
      return $dashboardWorkspaceRegistry.get(id)?.accentColor ?? railColor;
    }
    return railColor;
  })();

  // --- Tab-drag overlay state ---
  $: tabDrag = $tabDragState;
  $: tabDragToGroup =
    tabDrag?.dropTarget?.kind === "new-workspace-in-group" &&
    tabDrag.dropTarget.parentWorkspaceId === scopeId
      ? tabDrag.dropTarget
      : null;
  $: effectiveActive = active || tabDragToGroup !== null;
  // null source idx → every row's idx !== null → all rows show sibling overlay
  $: effectiveSourceIdx = active ? sourceIdx : (null as number | null);
  $: effectiveIndicator = active
    ? indicator
    : tabDragToGroup !== null
      ? { idx: tabDragToGroup.insertGlobalIdx, edge: tabDragToGroup.insertEdge }
      : (null as { idx: number; edge: "before" | "after" } | null);
  $: effectiveSourceHeight = active ? sourceHeight : 32;
  $: tabDragSurfaceLabel = (() => {
    if (!tabDrag || !tabDragToGroup) return "";
    const srcWs = $nestedWorkspaces.find(
      (w) => w.id === tabDrag!.sourceWorkspaceId,
    );
    if (!srcWs) return "New Workspace";
    return (
      getAllSurfaces(srcWs).find((s) => s.id === tabDrag!.surfaceId)?.title ||
      "New Workspace"
    );
  })();
  $: effectiveDropLabel = active ? sourceWs?.name : tabDragSurfaceLabel;
  $: effectiveDropAccent = active ? dropAccent : railColor;

  let itemRefs: Record<string, WorkspaceItem> = {};

  // Nested nestedWorkspaces share the same context menu surface as the root
  // workspace list: Rename / (Promote) / Close. Rename drives the
  // underlying WorkspaceItem's inline rename via the bound ref; everything
  // else routes through the workspace service. Kept local to
  // WorkspaceListView so this shared component doesn't need parent
  // callbacks for each item.
  function showNestedContextMenu(x: number, y: number, globalIdx: number) {
    const ws = $nestedWorkspaces[globalIdx];
    if (!ws) return;
    const md = wsMeta(ws);
    const isDashboard = md.isDashboard === true;
    const isInsideGroup = typeof md.parentWorkspaceId === "string";
    const isLocked = md.locked === true;
    const canPromoteCommand = get(commandStore).some(
      (c) => c.id === "promote-workspace-to-group",
    );
    const items = buildWorkspaceContextMenuItems({
      isDashboard,
      isInsideGroup,
      canPromoteCommand,
      workspaceCount: $nestedWorkspaces.length,
      isLocked,
      onRename: () => itemRefs[ws.id]?.startRename(),
      onPromote: () => {
        switchNestedWorkspace(globalIdx);
        const cmd = get(commandStore).find(
          (c) => c.id === "promote-workspace-to-group",
        );
        if (cmd) void cmd.action();
      },
      onToggleLock: () => toggleWorkspaceLock(ws.id),
      onClose: () => void confirmAndCloseWorkspace(ws, globalIdx),
    });
    contextMenu.set({ x, y, items });
  }
</script>

<!-- Skip the whole container when the workspace list is empty. The class
     applies an 8px top+left inset so nested rows breathe below the
     banner — rendering an empty container with that inset leaves a
     visible "lip" on the parent's rail. Guarding here keeps the rail
     flush when a container has no nested content at all. -->
{#if entries.length > 0}
  <div class="workspace-list-view">
    {#each entries as entry (entry.ws.id)}
      {@const isSrc = active && sourceIdx === entry.idx}
      {@const isSibling = effectiveActive && effectiveSourceIdx !== entry.idx}
      <div class="workspace-list-row" data-ws-view-drag-idx={entry.idx}>
        {#if effectiveIndicator?.idx === entry.idx && effectiveIndicator.edge === "before"}
          <DropGhost
            theme={$theme}
            height={effectiveSourceHeight}
            accent={effectiveDropAccent}
            label={effectiveDropLabel}
          />
        {/if}
        <div style="position: relative;">
          <WorkspaceItem
            bind:this={itemRefs[entry.ws.id]}
            workspace={entry.ws}
            index={entry.idx}
            isActive={entry.idx === $activeNestedWorkspaceIdx}
            dragActive={isSrc}
            {accentColor}
            dashboardHint={dashboardHintFor?.(entry.ws)}
            {hideStatusBadges}
            {isNested}
            onSelect={() => {
              if (!active) switchNestedWorkspace(entry.idx);
            }}
            onClose={() => void confirmAndCloseWorkspace(entry.ws, entry.idx)}
            onRename={(name) => renameNestedWorkspace(entry.idx, name)}
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
        {#if effectiveIndicator?.idx === entry.idx && effectiveIndicator.edge === "after"}
          <DropGhost
            theme={$theme}
            height={effectiveSourceHeight}
            accent={effectiveDropAccent}
            label={effectiveDropLabel}
          />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* 8px spacing between workspace rows within a nested list. Matched by
     WorkspaceListBlock's .root-row + rule for root-level rhythm. */
  .workspace-list-row + .workspace-list-row {
    margin-top: 8px;
  }
  /* 8px left + top margin on the nested list so the workspace rails
     sit visually inset from the parent project's rail and the first
     nested row breathes below the project banner. WorkspaceItem
     itself has no margin (root nestedWorkspaces are flush); we apply the
     inset here so it only fires in the nested context. */
  .workspace-list-view {
    margin-left: 8px;
    margin-top: 8px;
  }
</style>
