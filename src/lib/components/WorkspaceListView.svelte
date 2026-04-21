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
    switchWorkspace,
    closeWorkspace,
    renameWorkspace,
    reorderWorkspaces,
  } from "../services/workspace-service";
  import { get } from "svelte/store";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import DropGhost from "./DropGhost.svelte";
  import { contrastColor } from "../utils/contrast";
  import { contextMenu, showConfirmPrompt } from "../stores/ui";
  import { commandStore } from "../services/command-registry";
  import type { MenuItem } from "../context-menu-types";
  import { getDashboardContribution } from "../services/dashboard-contribution-registry";

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

  $: allEntries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => (filterIds ? filterIds.has(ws.id) : true));

  // Dashboard workspaces (metadata.isDashboard) render first as a pinned,
  // non-reorderable, full-color tile (no grip, no X, icon-only). Regular
  // workspaces render below via the standard WorkspaceItem path, fully
  // draggable among themselves. This mirrors the "Dashboard is the first
  // item in the nested list" invariant.
  function isDashboardWs(ws: import("../types").Workspace): boolean {
    return (
      (ws.metadata as Record<string, unknown> | undefined)?.isDashboard === true
    );
  }

  $: dashboardEntries = allEntries.filter(({ ws }) => isDashboardWs(ws));
  $: entries = allEntries.filter(({ ws }) => !isDashboardWs(ws));

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
  /**
   * Right-click menu for a dashboard tile. Extension-provided dashboards
   * (e.g. agentic) can be deleted from here — closing the workspace
   * lifts the per-group cap so "Add <Dashboard>" reappears in the
   * group's "+ New" dropdown; the backing markdown file stays on disk
   * so existing content survives a re-add. Core's built-in "group"
   * dashboard is excluded because it's referenced by
   * `group.dashboardWorkspaceId` and auto-materializes with the group.
   */
  function showDashboardContextMenu(
    x: number,
    y: number,
    globalIdx: number,
  ): void {
    const ws = $workspaces[globalIdx];
    if (!ws) return;
    const wsMeta = ws.metadata as Record<string, unknown> | undefined;
    const contribId = wsMeta?.dashboardContributionId;
    if (typeof contribId !== "string") return;
    if (contribId === "group") return;
    const contribution = getDashboardContribution(contribId);
    if (!contribution) return;
    const items: MenuItem[] = [
      {
        label: `Delete ${contribution.label}`,
        danger: true,
        action: async () => {
          const confirmed = await showConfirmPrompt(
            `Delete "${ws.name}"? The backing markdown file stays on disk so you can re-add this dashboard later without losing your edits.`,
            {
              title: `Delete ${contribution.label}`,
              confirmLabel: "Delete",
              cancelLabel: "Cancel",
            },
          );
          if (!confirmed) return;
          closeWorkspace(globalIdx);
        },
      },
    ];
    contextMenu.set({ x, y, items });
  }

  function showNestedContextMenu(x: number, y: number, globalIdx: number) {
    const ws = $workspaces[globalIdx];
    if (!ws) return;
    const wsMeta = ws.metadata as Record<string, unknown> | undefined;
    const isDashboard = wsMeta?.isDashboard === true;
    const isInsideGroup = typeof wsMeta?.groupId === "string";
    // Dashboards are singleton workspace surfaces closed with the group;
    // they don't support rename or promotion. Workspaces already nested
    // inside a group can't be promoted again — groups don't nest.
    const canPromote =
      !isDashboard &&
      !isInsideGroup &&
      get(commandStore).some((c) => c.id === "promote-workspace-to-group");
    const canRename = !isDashboard;

    const items: MenuItem[] = [
      ...(canRename
        ? [
            {
              label: "Rename Workspace",
              shortcut: "⇧⌘R",
              action: () => itemRefs[ws.id]?.startRename(),
            } as MenuItem,
          ]
        : []),
      ...(canPromote
        ? [
            { label: "", action: () => {}, separator: true } as MenuItem,
            {
              label: "Promote to Workspace Group...",
              action: () => {
                switchWorkspace(globalIdx);
                const cmd = get(commandStore).find(
                  (c) => c.id === "promote-workspace-to-group",
                );
                if (cmd) void cmd.action();
              },
            } as MenuItem,
          ]
        : []),
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: $workspaces.length <= 1 || isDashboard,
        action: () => closeWorkspace(globalIdx),
      },
    ];
    contextMenu.set({ x, y, items });
  }
</script>

<!-- Skip the whole container when both lists are empty. The class
     applies an 8px top+left inset so nested rows breathe below the
     banner — rendering an empty container with that inset leaves a
     visible "lip" on the parent's rail. Guarding here keeps the rail
     flush when a container has no nested content at all. -->
{#if dashboardEntries.length > 0 || entries.length > 0}
  <div class="workspace-list-view">
    {#if dashboardEntries.length > 0}
      {@const count = dashboardEntries.length}
      {@const cols = Math.min(count, 3)}
      {@const isNested = !!accentColor}
      <!-- Dashboards share a grid container so they fill available width.
           Up to 3 per row; extras wrap. A container query collapses tiles
           to icon-only when there's genuinely no room for labels. -->
      <div
        class="dashboard-grid"
        data-dashboard-count={count}
        data-multi={count > 1 ? "true" : undefined}
        style="--cols: {cols};"
      >
        {#each dashboardEntries as entry (entry.ws.id)}
          {@const dashAccent = accentColor ?? $theme.accent}
          {@const isActive = entry.idx === $activeWorkspaceIdx}
          {@const wsMeta = entry.ws.metadata as
            | Record<string, unknown>
            | undefined}
          {@const isAgentic = wsMeta?.dashboardContributionId === "agentic"}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="dashboard-tile"
            data-dashboard-item={entry.ws.id}
            data-dashboard-agentic={isAgentic ? "true" : undefined}
            data-active={isActive ? "true" : undefined}
            title={entry.ws.name}
            on:click={() => switchWorkspace(entry.idx)}
            on:contextmenu|preventDefault={(e) =>
              showDashboardContextMenu(e.clientX, e.clientY, entry.idx)}
            style="
              background: {$theme.bgSurface ?? 'transparent'};
              color: {$theme.fg};
              border: 1px solid {$theme.border ?? 'transparent'};
              opacity: {isActive ? 1 : 0.75};
              {isActive ? `box-shadow: 0 0 0 1.5px ${dashAccent};` : ''}
            "
          >
            {#if isNested}
              <span
                class="dashboard-tile-icon"
                aria-hidden="true"
                style="color: {dashAccent};"
              >
                {#if isAgentic}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <title>{entry.ws.name}</title>
                    <path d="M12 8V4H8" />
                    <rect width="16" height="12" x="4" y="8" rx="2" />
                    <path d="M2 14h2" />
                    <path d="M20 14h2" />
                    <path d="M15 13v2" />
                    <path d="M9 13v2" />
                  </svg>
                {:else}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <title>{entry.ws.name}</title>
                    <rect x="3" y="3" width="7" height="9" />
                    <rect x="14" y="3" width="7" height="5" />
                    <rect x="14" y="12" width="7" height="9" />
                    <rect x="3" y="16" width="7" height="5" />
                  </svg>
                {/if}
              </span>
            {/if}
            <span class="dashboard-tile-label">{entry.ws.name}</span>
          </div>
        {/each}
      </div>
    {/if}
    {#each entries as entry (entry.ws.id)}
      {@const isSrc = active && sourceIdx === entry.idx}
      {@const isSibling = active && sourceIdx !== entry.idx}
      <div class="workspace-list-row" data-ws-view-drag-idx={entry.idx}>
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
            dashboardHint={dashboardHintFor?.(entry.ws)}
            {hideStatusBadges}
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
  /* Uniform 8px rhythm across the nested column: banner→dashboard,
     dashboard→first-workspace, and workspace→workspace all use the
     same gap so the rail reads as an evenly-spaced stack. Matched by
     WorkspaceListBlock's .root-row + rule for root-level rhythm. */
  .workspace-list-row + .workspace-list-row {
    margin-top: 8px;
  }
  .dashboard-grid + .workspace-list-row {
    margin-top: 8px;
  }

  /* Dashboard grid — up to 3 equal-width tiles per row; extras wrap.
     `container-type: inline-size` lets us collapse to icon-only when
     the grid container is too narrow to fit labels. */
  .dashboard-grid {
    display: grid;
    grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
    gap: 8px;
    margin-right: 8px;
    container-type: inline-size;
  }
  .dashboard-tile {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    min-height: 32px;
    min-width: 0;
    border-radius: 6px;
    cursor: pointer;
    transition:
      opacity 0.12s,
      box-shadow 0.12s,
      filter 0.12s;
  }
  .dashboard-tile:hover {
    filter: brightness(1.1);
  }
  .dashboard-tile-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }
  .dashboard-tile-label {
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  /* When the grid is too narrow to fit labels meaningfully, collapse
     to icon-only. Gated on `data-multi` (set when there are 2+ tiles)
     — a lone dashboard keeps its label even in narrow sidebars.
     Threshold tightened to 140px so the label only hides in very
     cramped widths. */
  @container (max-width: 140px) {
    .dashboard-grid[data-multi="true"] .dashboard-tile {
      padding: 6px;
    }
    .dashboard-grid[data-multi="true"] .dashboard-tile-label {
      display: none;
    }
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
