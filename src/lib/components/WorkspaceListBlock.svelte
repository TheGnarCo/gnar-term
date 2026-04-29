<script lang="ts">
  /**
   * WorkspaceListBlock — core-owned renderer of the Workspaces
   * section. Iterates the unified rootRowOrder store and renders each
   * row with a core-drawn grip column on the left.
   *
   * Row kinds:
   *   - "workspace"        → unclaimed workspace, rendered via WorkspaceItem
   *   - "pseudo-workspace" → pinned extension row rendered via PseudoWorkspaceRow
   *   - other              → looked up from rootRowRendererStore (projects
   *                          register "project" as a renderer on activate).
   *
   * This block OWNS the drag pipeline for the root list. Renderers
   * inherit drag behavior — they do not spin up their own reorder
   * logic at the root level. Nested pipelines (a project's own
   * workspace list) are unchanged and still live inside
   * WorkspaceListView.
   */
  import { derived, get } from "svelte/store";
  import { theme } from "../stores/theme";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import {
    contextMenu,
    reorderContext,
    anyReorderActive,
    metaPreviewActive,
  } from "../stores/ui";
  import { confirmAndCloseWorkspace } from "../services/worktree-service";
  import {
    rootRowOrder,
    moveRootRow,
    type RootRow,
  } from "../stores/root-row-order";
  import { rootRowRendererStore } from "../services/root-row-renderer-registry";
  import { claimedWorkspaceIds } from "../services/claimed-workspace-registry";
  import {
    pseudoWorkspaceStore,
    type PseudoWorkspace,
  } from "../services/pseudo-workspace-registry";
  import { createDragReorder } from "../actions/drag-reorder";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import PseudoWorkspaceRow from "./PseudoWorkspaceRow.svelte";
  import DropGhost from "./DropGhost.svelte";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import { getExtensionApiById } from "../services/extension-loader";
  import { contrastColor } from "../utils/contrast";
  import { shortcutHint } from "../actions/shortcut-hint";
  import { modLabel } from "../terminal-service";
  import { getAllSurfaces, type Workspace } from "../types";
  import { commandStore } from "../services/command-registry";
  import { tabDragState } from "../services/tab-drag";
  import {
    detectWorkspacePaneDrop,
    setWorkspaceDragState,
    createDragDenyOverlay,
    removeDragDenyOverlay,
    type WorkspacePaneDropTarget,
  } from "../services/workspace-drag";
  import { expandWorkspaceIntoPanes } from "../services/pane-service";
  import { dashboardWorkspaceRegistry } from "../services/dashboard-workspace-service";
  import { configStore } from "../config";
  import { resolveGroupColor } from "../theme-data";
  import { archiveWorkspace, archiveGroup } from "../services/archive-service";
  import { buildWorkspaceContextMenuItems } from "../utils/workspace-context-menu";
  import { wsMeta } from "../services/service-helpers";

  function resolvePseudoWorkspaceColor(pw: PseudoWorkspace): string {
    const slot = $configStore.pseudoWorkspaceColors?.[pw.id] ?? "purple";
    return resolveGroupColor(slot, $theme);
  }

  export let onSwitchWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;

  // Exposed via bind:this so PrimarySidebar's "rename active" keyboard
  // handler can trigger inline rename on a specific workspace index.
  let workspaceItems: Record<string, WorkspaceItem> = {};
  export function startRename(globalIdx: number) {
    const ws = $workspaces[globalIdx];
    const item = ws ? workspaceItems[ws.id] : undefined;
    if (item) item.startRename();
  }

  // Derived view: rootRowOrder as-is plus per-row metadata we need at
  // render time (source workspace for workspace rows, renderer
  // component for other kinds). Rows whose referent is missing are
  // skipped — this tolerates stale persisted entries that outlived
  // their workspace or project. Workspaces present in the store but
  // NOT in rootRowOrder are auto-appended at render time: this covers
  // first-run installs (empty persisted order), direct
  // `workspaces.set` in tests, and any path that skips the service
  // helpers.
  type RenderedRow = {
    row: RootRow;
    idx: number;
    key: string;
    workspace?: Workspace;
    rendererComponent?: unknown;
    rendererSource?: string;
    rendererRailColor?: string;
    rendererLabel?: string;
    pseudoWorkspace?: PseudoWorkspace;
  };
  // Use `derived()` (not a `$:` IIFE) so Svelte's store-subscription
  // plumbing tracks the sources explicitly. An earlier attempt wrapped
  // the computation in a `$:` IIFE and the dependencies weren't
  // detected reliably across HMR.
  const renderedRowsStore = derived(
    [
      workspaces,
      rootRowOrder,
      rootRowRendererStore,
      claimedWorkspaceIds,
      pseudoWorkspaceStore,
    ],
    ([$ws, $order, $renderers, $claimed, $pseudoWs]) => {
      const rows: RenderedRow[] = [];
      const byId = new Map(
        $ws
          .filter((ws) => !$claimed.has(ws.id))
          .map((ws) => [ws.id, ws] as const),
      );
      const renderers = new Map($renderers.map((r) => [r.id, r] as const));
      const pseudoById = new Map($pseudoWs.map((pw) => [pw.id, pw] as const));
      const renderedWsIds = new Set<string>();
      $order.forEach((row, idx) => {
        const key = `${row.kind}:${row.id}`;
        if (row.kind === "workspace") {
          const ws = byId.get(row.id);
          if (!ws) return;
          rows.push({ row, idx, key, workspace: ws });
          renderedWsIds.add(ws.id);
          return;
        }
        if (row.kind === "pseudo-workspace") {
          const pw = pseudoById.get(row.id);
          if (!pw) return;
          rows.push({ row, idx, key, pseudoWorkspace: pw });
          return;
        }
        const r = renderers.get(row.kind);
        if (!r) return;
        rows.push({
          row,
          idx,
          key,
          rendererComponent: r.component,
          rendererSource: r.source,
          rendererRailColor: r.railColor?.(row.id),
          rendererLabel: r.label?.(row.id),
        });
      });
      // Fallback — any unclaimed workspace in the store that isn't
      // already rendered gets appended at the end. Covers first-run
      // installs (empty persisted order), direct `workspaces.set` in
      // tests, and stale rootRowOrder entries whose workspace ids were
      // regenerated across sessions.
      if (renderedWsIds.size < byId.size) {
        let idx = $order.length;
        for (const [id, ws] of byId) {
          if (renderedWsIds.has(id)) continue;
          rows.push({
            row: { kind: "workspace", id },
            idx: idx++,
            key: `workspace:${id}`,
            workspace: ws,
          });
        }
      }
      return rows;
    },
  );
  $: renderedRows = $renderedRowsStore;

  // --- Unified drag pipeline for the root list ---
  //
  // One createDragReorder owns reordering across workspace rows AND
  // project rows. The dataAttr "root-row-idx" tags each rendered row
  // with its index into $rootRowOrder (NOT the filtered renderedRows
  // list — drops must target the underlying store positions).
  let dragSourceIdx: number | null = null;
  let insertIndicator: { idx: number; edge: "before" | "after" } | null = null;
  let dragActive = false;
  let dragSourceHeight = 0;

  // Workspace-to-pane drop state: updated on every mousemove during a root drag.
  let currentPaneTarget: WorkspacePaneDropTarget = null;

  // Archive zone drag state: true when the dragged row is hovering over [data-archive-zone].
  let overArchiveZone = false;

  const rootDrag = createDragReorder({
    dataAttr: "root-row-idx",
    containerSelector: "#primary-sidebar",
    ghostStyle: () => ({
      background: $theme.bgFloat ?? $theme.bgSurface ?? "#111",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    canStart: () => !$anyReorderActive,
    onDrop: (from, to) => moveRootRow(from, to),
    onMove: (x, y, ghostEl) => {
      const fromIdx = rootDrag.getState().sourceIdx;
      if (fromIdx === null) return;
      // Archive zone detection runs for all row kinds (workspace AND workspace-group).
      const archiveEl = document.querySelector("[data-archive-zone]");
      if (archiveEl) {
        const rect = archiveEl.getBoundingClientRect();
        const over =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
        if (over !== overArchiveZone) {
          overArchiveZone = over;
          if (over) {
            archiveEl.setAttribute("data-drag-over", "true");
          } else {
            archiveEl.removeAttribute("data-drag-over");
          }
        }
      }
      const srcRow = $rootRowOrder[fromIdx];
      if (srcRow?.kind !== "workspace") {
        currentPaneTarget = null;
        setWorkspaceDragState(null);
        return;
      }
      currentPaneTarget = detectWorkspacePaneDrop(x, y, srcRow.id);
      setWorkspaceDragState(
        currentPaneTarget !== null
          ? { workspaceId: srcRow.id, dropTarget: currentPaneTarget }
          : null,
      );
      // Mutate the ghost to show deny state when incompatible group
      if (ghostEl) {
        if (currentPaneTarget?.kind === "deny") {
          createDragDenyOverlay(ghostEl);
        } else {
          removeDragDenyOverlay(ghostEl);
        }
      }
    },
    onDragCommit: (fromIdx) => {
      if (overArchiveZone) {
        overArchiveZone = false;
        document
          .querySelector("[data-archive-zone]")
          ?.removeAttribute("data-drag-over");
        currentPaneTarget = null;
        setWorkspaceDragState(null);
        const srcRow = $rootRowOrder[fromIdx];
        if (srcRow?.kind === "workspace") void archiveWorkspace(srcRow.id);
        else if (srcRow?.kind === "workspace-group")
          void archiveGroup(srcRow.id);
        return true; // suppress normal rootRowOrder reorder
      }
      const paneTarget = currentPaneTarget;
      currentPaneTarget = null;
      setWorkspaceDragState(null);
      if (paneTarget?.kind === "pane-split") {
        const srcRow = $rootRowOrder[fromIdx];
        if (srcRow?.kind === "workspace") {
          const direction =
            paneTarget.zone === "left" || paneTarget.zone === "right"
              ? "horizontal"
              : "vertical";
          const before =
            paneTarget.zone === "left" || paneTarget.zone === "top";
          expandWorkspaceIntoPanes(
            srcRow.id,
            paneTarget.paneId,
            direction,
            before,
          );
        }
      }
      // Suppress sidebar reorder for any pane target (split OR deny) so
      // the workspace doesn't get accidentally reordered on a failed drop.
      return paneTarget !== null;
    },
    onStateChange: () => {
      const s = rootDrag.getState();
      dragSourceIdx = s.sourceIdx;
      insertIndicator = s.indicator;
      dragActive = s.active;
      dragSourceHeight = s.sourceHeight;
      if (!s.active) {
        // Clean up workspace drag state when drag ends
        currentPaneTarget = null;
        setWorkspaceDragState(null);
        overArchiveZone = false;
        document
          .querySelector("[data-archive-zone]")
          ?.removeAttribute("data-drag-over");
      }
      if (s.active && s.sourceIdx !== null) {
        const src = $rootRowOrder[s.sourceIdx];
        reorderContext.set(
          src
            ? {
                kind: "rootRow",
                sourceKind: src.kind,
                sourceId: src.id,
                containerBlockId: "__workspaces__",
              }
            : null,
        );
      } else {
        reorderContext.set(null);
      }
    },
  });

  function startRootRowDrag(e: MouseEvent, rowIdx: number) {
    rootDrag.start(e, rowIdx);
  }

  // Source row metadata used for the DropGhost label/color so the
  // drop slot reads as the dragged row's own tile. Looks up the
  // row's rendered metadata from renderedRows so workspaces use the
  // theme accent / workspace name, and projects use the project's
  // color + name via the registered railColor/label resolvers.
  $: sourceRow =
    dragActive && dragSourceIdx !== null ? $rootRowOrder[dragSourceIdx] : null;
  $: sourceEntry =
    sourceRow != null
      ? renderedRows.find(
          (e) => e.row.kind === sourceRow!.kind && e.row.id === sourceRow!.id,
        )
      : undefined;
  $: sourceRowColor = (() => {
    if (sourceEntry?.rendererRailColor) return sourceEntry.rendererRailColor;
    const pw = sourceEntry?.pseudoWorkspace;
    if (pw) return resolvePseudoWorkspaceColor(pw);
    const ws = sourceEntry?.workspace;
    if (ws) {
      const dashId = wsMeta(ws).dashboardWorkspaceId;
      if (typeof dashId === "string") {
        return (
          $dashboardWorkspaceRegistry.get(dashId)?.accentColor ?? $theme.accent
        );
      }
    }
    return $theme.accent;
  })();
  $: sourceRowLabel =
    sourceEntry?.pseudoWorkspace?.label ??
    sourceEntry?.rendererLabel ??
    sourceEntry?.workspace?.name ??
    "";

  // --- Tab-drag overlay state ---
  // When a tab is being dragged over the root row list, synthesize the same
  // effective drag variables that the native workspace reorder uses, so the
  // sibling overlay and DropGhost indicators render identically.
  $: tabDrag = $tabDragState;
  $: tabDragToRoot =
    tabDrag?.dropTarget?.kind === "new-workspace" ? tabDrag.dropTarget : null;
  $: effectiveActive =
    dragActive || tabDragToRoot !== null || $metaPreviewActive;
  // null source idx → every row's idx !== null → all rows show sibling overlay
  $: effectiveDragSourceIdx = dragActive
    ? dragSourceIdx
    : (null as number | null);
  $: effectiveInsertIndicator = dragActive
    ? insertIndicator
    : tabDragToRoot !== null
      ? { idx: tabDragToRoot.insertIdx, edge: tabDragToRoot.insertEdge }
      : (null as { idx: number; edge: "before" | "after" } | null);
  $: effectiveDragSourceHeight = dragActive ? dragSourceHeight : 32;
  $: tabDragSurfaceTitle = (() => {
    if (!tabDrag) return "";
    const srcWs = $workspaces.find((w) => w.id === tabDrag!.sourceWorkspaceId);
    if (!srcWs) return "New Workspace";
    return (
      getAllSurfaces(srcWs).find((s) => s.id === tabDrag!.surfaceId)?.title ||
      "New Workspace"
    );
  })();
  $: effectiveSourceRowLabel = dragActive
    ? sourceRowLabel
    : tabDragSurfaceTitle;
  $: effectiveSourceRowColor = dragActive ? sourceRowColor : $theme.accent;

  // --- Workspace row context menu (previously in WorkspaceListBlock's
  // showWorkspaceContextMenu; unchanged modulo re-scoping to rendered
  // root rows). ---
  function runPromoteToProject(globalIdx: number) {
    onSwitchWorkspace(globalIdx);
    const cmd = get(commandStore).find(
      (c) => c.id === "promote-workspace-to-group",
    );
    if (cmd) void cmd.action();
  }

  $: canPromote = $commandStore.some(
    (c) => c.id === "promote-workspace-to-group",
  );

  function showWorkspaceContextMenu(x: number, y: number, globalIdx: number) {
    const ws = $workspaces[globalIdx];
    if (!ws) return;
    const md = wsMeta(ws);
    const isDashboard = md?.isDashboard === true;
    const isInsideGroup = typeof md?.groupId === "string";
    const items = buildWorkspaceContextMenuItems({
      isDashboard,
      isInsideGroup,
      canPromoteCommand: canPromote,
      workspaceCount: $workspaces.length,
      onRename: () => startRename(globalIdx),
      onNewSurface: () => {
        onSwitchWorkspace(globalIdx);
        onNewSurface();
      },
      onPromote: () => runPromoteToProject(globalIdx),
      onArchive: () => void archiveWorkspace(ws.id),
      onClose: () => void confirmAndCloseWorkspace(ws, globalIdx),
    });
    contextMenu.set({ x, y, items });
  }
</script>

<!-- No "Workspaces" label row here anymore. The label was redundant
     (there's only one root section), and the "+ New" split-button
     moved up into PrimarySidebar's top row so it aligns with the
     other title-row buttons. -->

<!-- Root rows: workspaces and whole project blocks interleaved per
     $rootRowOrder. Each row is shelled with a core-drawn DragGrip
     (left) + content (right). Non-source rows during a drag get a
     strong overlay with the row's own color + name centered. -->
{#each renderedRows as entry (entry.key)}
  {@const isSource = dragActive && dragSourceIdx === entry.idx}
  {@const isSibling = effectiveActive && effectiveDragSourceIdx !== entry.idx}
  {@const ws = entry.workspace}
  {@const _dashId = ws ? wsMeta(ws).dashboardWorkspaceId : undefined}
  {@const rowColor =
    entry.rendererRailColor ??
    (entry.pseudoWorkspace
      ? resolvePseudoWorkspaceColor(entry.pseudoWorkspace)
      : typeof _dashId === "string"
        ? ($dashboardWorkspaceRegistry.get(_dashId)?.accentColor ??
          $theme.accent)
        : $theme.accent)}
  {@const rowFg = contrastColor(rowColor)}
  {@const rowLabel =
    entry.row.kind === "workspace" && ws
      ? ws.name
      : entry.row.kind === "pseudo-workspace" && entry.pseudoWorkspace
        ? entry.pseudoWorkspace.label
        : (entry.rendererLabel ?? "")}
  <div class="root-row" data-root-row-container={entry.idx}>
    {#if effectiveInsertIndicator?.idx === entry.idx && effectiveInsertIndicator.edge === "before"}
      <DropGhost
        theme={$theme}
        height={effectiveDragSourceHeight}
        accent={effectiveSourceRowColor}
        label={effectiveSourceRowLabel}
      />
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-root-row-idx={entry.idx}
      style="
        display: {isSource ? 'none' : 'block'};
        position: relative;
      "
    >
      <!-- Row content — the renderer draws its OWN grip (via
           onGripMouseDown) so the row looks self-contained (no gap
           between active workspace bg and its rail, matching the
           nested-workspace style). Core still owns the drag pipeline
           — the renderer's grip just calls back into startRootRowDrag. -->
      {#if entry.row.kind === "workspace" && ws}
        {@const globalIdx = $workspaces.indexOf(ws)}
        <WorkspaceItem
          bind:this={workspaceItems[ws.id]}
          workspace={ws}
          index={globalIdx}
          shortcutIdx={entry.idx}
          isActive={globalIdx === $activeWorkspaceIdx}
          dragActive={isSource}
          onSelect={() => {
            if (!dragActive) onSwitchWorkspace(globalIdx);
          }}
          onClose={() => void confirmAndCloseWorkspace(ws, globalIdx)}
          onRename={(name) => onRenameWorkspace(globalIdx, name)}
          onContextMenu={(x, y) => showWorkspaceContextMenu(x, y, globalIdx)}
          onGripMouseDown={(e) => startRootRowDrag(e, entry.idx)}
        />
      {:else if entry.row.kind === "pseudo-workspace" && entry.pseudoWorkspace}
        <PseudoWorkspaceRow
          pseudo={entry.pseudoWorkspace}
          shortcutIdx={entry.idx}
          onGripMouseDown={(e) => startRootRowDrag(e, entry.idx)}
        />
      {:else if entry.rendererComponent && entry.rendererSource}
        {@const extApi = getExtensionApiById(entry.rendererSource)}
        {#if extApi}
          <div
            use:shortcutHint={entry.idx < 9
              ? `${modLabel}${entry.idx + 1}`
              : undefined}
          >
            <ExtensionWrapper
              api={extApi}
              component={entry.rendererComponent}
              props={{
                id: entry.row.id,
                onGripMouseDown: (e: MouseEvent) =>
                  startRootRowDrag(e, entry.idx),
              }}
            />
          </div>
        {/if}
      {/if}

      {#if isSibling}
        <!-- Strong overlay on non-source root rows during a drag.
             Shaped like a workspace row (rounded right + 8px trailing
             margin) so the drop context reads as a stack of tiles
             matching the row shape, not as a full-width wash. -->
        <div
          aria-hidden="true"
          style="
            position: absolute; inset: 0 8px 0 0;
            background: {rowColor}; color: {rowFg};
            display: flex; align-items: center; justify-content: center;
            font-size: 13px; font-weight: 600;
            pointer-events: none;
            z-index: 3;
            border-radius: 0 6px 6px 0;
          "
        >
          {rowLabel}
        </div>
      {/if}
    </div>
    {#if effectiveInsertIndicator?.idx === entry.idx && effectiveInsertIndicator.edge === "after"}
      <DropGhost
        theme={$theme}
        height={effectiveDragSourceHeight}
        accent={effectiveSourceRowColor}
        label={effectiveSourceRowLabel}
      />
    {/if}
  </div>
{/each}

{#if renderedRows.length === 0}
  <div
    style="
      display: flex; align-items: center;
      margin: 0 8px 0 0; border-radius: 0 6px 6px 0;
      border: 1px dashed {$theme.border};
      opacity: 0.45;
    "
  >
    <div style="width: 14px; flex-shrink: 0;"></div>
    <div
      style="flex: 1; padding: 8px 6px; color: {$theme.fgDim}; font-size: 12px;"
    >
      No workspaces
    </div>
  </div>
{/if}

<style>
  /* Inter-row gap — matches the nested workspace inter-row gap
     (see WorkspaceListView's .workspace-list-row + rule) so root and
     nested lists share the same 8px vertical rhythm. */
  .root-row + .root-row {
    margin-top: 8px;
  }
</style>
