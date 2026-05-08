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
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { theme } from "../stores/theme";
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
    switchWorkspace,
    renameWorkspace,
    reorderWorkspaces,
    toggleWorkspaceLock,
  } from "../services/workspace-runtime-service";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import DropGhost from "./DropGhost.svelte";
  import { contrastColor } from "../utils/contrast";
  import { contextMenu } from "../stores/ui";
  import { confirmAndCloseWorkspace } from "../services/worktree-service";
  import { globalSurfaceRegistry } from "../services/global-surface-service";
  import { buildWorkspaceContextMenuItems } from "../utils/workspace-context-menu";

  /** Set of workspace IDs to display. If undefined, shows all. */
  export let filterIds: Set<string> | undefined = undefined;

  /** Workspace accent color passed to each WorkspaceItem for left-border coloring. */
  export let accentColor: string | undefined = undefined;

  /**
   * Optional per-workspace dashboard hint provider. When set, each rendered
   * WorkspaceItem receives the result as its `dashboardHint` prop — a small
   * clickable dashboard icon whose handler the caller owns. Used by
   * AgentDashboardRow to navigate back to a child workspace's owning
   * dashboard without selecting the workspace.
   */
  export let dashboardHintFor:
    | ((
        ws: import("../types").Workspace,
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
   * The immediate container ("scope") this list's workspaces live in — a
   * Workspace id when rendered inside a Workspace's nested list,
   * otherwise "__workspaces__". Published to `reorderContext` as
   * `scopeId` during a drag so the sidebar's overlay layer knows which
   * Workspace is the source.
   */
  export let scopeId: string | null = null;

  /**
   * The top-level sidebar block id that hosts this list. Used to render
   * block-level dims for non-source blocks during a workspace drag from
   * here.
   */
  export let containerBlockId: string | null = null;

  $: allEntries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => (filterIds ? filterIds.has(ws.id) : true));

  $: entries = allEntries.filter(({ ws }) => ws.isDashboard !== true);

  $: isChild = scopeId !== null;

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
      const srcWsId = $workspaces[sourceIdx]?.id;
      if (!srcWsId) return;
      // Tab bar hover: only the deny case is relevant (no merge path).
      const tabTarget = detectTabBarDropForWorkspace(x, y, srcWsId);
      const effectivePaneTarget =
        tabTarget?.kind === "deny"
          ? tabTarget
          : tabTarget?.kind === "tab-merge"
            ? null
            : (tabTarget ?? detectWorkspacePaneDrop(x, y, srcWsId));
      currentPaneTarget = effectivePaneTarget;
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
    onDragCommit: () => {
      const paneTarget = currentPaneTarget;
      currentPaneTarget = null;
      setWorkspaceDragState(null);
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
          kind: "branch",
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
    // Locked workspaces refuse drag-start. canStart in createDragReorder
    // fires before sourceIdx is populated, so we gate here instead.
    const ws = $workspaces[globalIdx];
    if (ws && ws.locked === true) return;
    reorder.start(e, globalIdx);
  }

  // Source metadata used for the DropGhost label + non-source
  // overlay color so the drag feedback matches the root-level style
  // (Workspace + branch rows show their own tile with name centered).
  $: sourceWs =
    active && sourceIdx !== null
      ? ($workspaces.find((w, i) => i === sourceIdx) ?? null)
      : null;
  $: railColor = accentColor ?? $theme.accent;
  $: overlayFg = contrastColor(railColor);
  $: dropAccent = (() => {
    if (sourceWs?.isDashboard !== true) return railColor;
    const id = sourceWs.dashboardContributionId;
    if (typeof id === "string") {
      return $globalSurfaceRegistry.get(id)?.accentColor ?? railColor;
    }
    return railColor;
  })();

  $: effectiveActive = active;
  $: effectiveSourceIdx = sourceIdx;
  $: effectiveIndicator = indicator;
  $: effectiveSourceHeight = sourceHeight;
  $: effectiveDropLabel = sourceWs?.name;
  $: effectiveDropAccent = dropAccent;

  let itemRefs: Record<string, WorkspaceItem> = {};

  // Child workspaces share the same context menu surface as the root
  // workspace list: Rename / Close. Rename drives the underlying
  // WorkspaceItem's inline rename via the bound ref; everything else
  // routes through the workspace service. Kept local to
  // WorkspaceListView so this shared component doesn't need parent
  // callbacks for each item.
  function showChildContextMenu(x: number, y: number, globalIdx: number) {
    const ws = $workspaces[globalIdx];
    if (!ws) return;
    const isDashboard = ws.isDashboard === true;
    const isLocked = ws.locked === true;
    const items = buildWorkspaceContextMenuItems({
      isDashboard,
      workspaceCount: $workspaces.length,
      isLocked,
      onRename: () => itemRefs[ws.id]?.startRename(),
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
            isActive={entry.idx === $activeWorkspaceIdx}
            dragActive={isSrc}
            {accentColor}
            dashboardHint={dashboardHintFor?.(entry.ws)}
            {hideStatusBadges}
            {isChild}
            onSelect={() => {
              if (!active) switchWorkspace(entry.idx);
            }}
            onClose={() => void confirmAndCloseWorkspace(entry.ws, entry.idx)}
            onRename={(name) => renameWorkspace(entry.idx, name)}
            onContextMenu={(x, y) => showChildContextMenu(x, y, entry.idx)}
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
              margin-right: 4px;
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
     sit visually inset from the root Workspace's rail and the first
     nested row breathes below the Workspace banner. WorkspaceItem
     itself has no margin (root Workspaces are flush); we apply the
     inset here so it only fires in the nested context. */
  .workspace-list-view {
    margin-left: 8px;
    margin-top: 8px;
  }
</style>
