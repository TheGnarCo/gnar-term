<script lang="ts">
  /**
   * WorkspaceListBlock — core-owned renderer of the Workspaces
   * section. Iterates the unified rootRowOrder store and renders each
   * row with a core-drawn grip column on the left.
   *
   * Row kinds:
   *   - "nested-workspace" → unclaimed nested workspace, rendered via WorkspaceItem
   *   - "workspace"        → workspace block, rendered via the registered renderer
   *   - "pseudo-workspace" → pinned extension row rendered via PseudoWorkspaceRow
   *   - other              → looked up from rootRowRendererStore.
   *
   * This block OWNS the drag pipeline for the root list. Renderers
   * inherit drag behavior — they do not spin up their own reorder
   * logic at the root level. Nested pipelines (a project's own
   * workspace list) are unchanged and still live inside
   * WorkspaceListView.
   */
  import { derived, get } from "svelte/store";
  import { theme } from "../stores/theme";
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
  } from "../stores/nested-workspace";
  import { contextMenu, reorderContext, anyReorderActive } from "../stores/ui";
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

  import { getAllSurfaces, type NestedWorkspace } from "../types";
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
  import { resolveWorkspaceColor } from "../theme-data";
  import { archiveWorkspace } from "../services/archive-service";
  import { buildWorkspaceContextMenuItems } from "../utils/workspace-context-menu";
  import { wsMeta } from "../services/service-helpers";
  import { toggleWorkspaceLock } from "../services/nested-workspace-service";
  import { getWorkspace } from "../stores/workspaces";

  function resolvePseudoWorkspaceColor(pw: PseudoWorkspace): string {
    const slot = $configStore.pseudoWorkspaceColors?.[pw.id] ?? "purple";
    return resolveWorkspaceColor(slot, $theme);
  }

  export let onSwitchWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;

  // Exposed via bind:this so Sidebar's "rename active" keyboard
  // handler can trigger inline rename on a specific workspace index.
  let workspaceItems: Record<string, WorkspaceItem> = {};
  export function startRename(globalIdx: number) {
    const ws = $nestedWorkspaces[globalIdx];
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
  // `nestedWorkspaces.set` in tests, and any path that skips the service
  // helpers.
  type RenderedRow = {
    row: RootRow;
    idx: number;
    key: string;
    workspace?: NestedWorkspace;
    rendererComponent?: unknown;
    rendererSource?: string;
    rendererRailColor?: string;
    rendererLabel?: string;
    pseudoWorkspace?: PseudoWorkspace;
    workspaceOnlyIdx?: number;
  };
  // Use `derived()` (not a `$:` IIFE) so Svelte's store-subscription
  // plumbing tracks the sources explicitly. An earlier attempt wrapped
  // the computation in a `$:` IIFE and the dependencies weren't
  // detected reliably across HMR.
  const renderedRowsStore = derived(
    [
      nestedWorkspaces,
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
      let workspaceCount = 0;
      $order.forEach((row, idx) => {
        const key = `${row.kind}:${row.id}`;
        if (row.kind === "nested-workspace") {
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
        const workspaceOnlyIdx =
          row.kind === "workspace" ? workspaceCount++ : undefined;
        rows.push({
          row,
          idx,
          key,
          rendererComponent: r.component,
          rendererSource: r.source,
          rendererRailColor: r.railColor?.(row.id),
          rendererLabel: r.label?.(row.id),
          workspaceOnlyIdx,
        });
      });
      // Fallback — any unclaimed workspace in the store that isn't
      // already rendered gets appended at the end. Covers first-run
      // installs (empty persisted order), direct `nestedWorkspaces.set` in
      // tests, and stale rootRowOrder entries whose workspace ids were
      // regenerated across sessions.
      if (renderedWsIds.size < byId.size) {
        let idx = $order.length;
        for (const [id, ws] of byId) {
          if (renderedWsIds.has(id)) continue;
          rows.push({
            row: { kind: "nested-workspace", id },
            idx: idx++,
            key: `nested-workspace:${id}`,
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

  // NestedWorkspace-to-pane drop state: updated on every mousemove during a root drag.
  let currentPaneTarget: WorkspacePaneDropTarget = null;

  // Archive zone drag state: true when the dragged row is hovering over [data-archive-zone].
  let overArchiveZone = false;

  const rootDrag = createDragReorder({
    dataAttr: "root-row-idx",
    containerSelector: "#sidebar",
    ghostStyle: () => ({
      background: "transparent",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    canStart: () => !$anyReorderActive,
    onDrop: (from, to) => moveRootRow(from, to),
    onMove: (x, y, ghostEl) => {
      const fromIdx = rootDrag.getState().sourceIdx;
      if (fromIdx === null) return;
      // Archive zone hit-test runs for all row kinds (nested-workspace AND
      // workspace). Tracks `overArchiveZone` so the drop commit can route to
      // archiveWorkspace; no visual feedback is painted on the zone — UX
      // calls for the archive section to keep its normal appearance during
      // a drag.
      const archiveEl = document.querySelector("[data-archive-zone]");
      if (archiveEl) {
        const rect = archiveEl.getBoundingClientRect();
        overArchiveZone =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
      }
      const srcRow = $rootRowOrder[fromIdx];
      if (srcRow?.kind !== "nested-workspace") {
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
      // Mutate the ghost to show deny state when incompatible drop target
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
        currentPaneTarget = null;
        setWorkspaceDragState(null);
        const srcRow = $rootRowOrder[fromIdx];
        if (srcRow?.kind === "workspace") void archiveWorkspace(srcRow.id);
        return true; // suppress normal rootRowOrder reorder
      }
      const paneTarget = currentPaneTarget;
      currentPaneTarget = null;
      setWorkspaceDragState(null);
      if (paneTarget?.kind === "pane-split") {
        const srcRow = $rootRowOrder[fromIdx];
        if (srcRow?.kind === "nested-workspace") {
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
    const srcRow = $rootRowOrder[rowIdx];
    if (srcRow?.kind === "nested-workspace") {
      const ws = $nestedWorkspaces.find((w) => w.id === srcRow.id);
      if (ws && wsMeta(ws).locked === true) return;
    } else if (srcRow?.kind === "workspace") {
      const workspace = getWorkspace(srcRow.id);
      if (workspace?.locked === true) return;
    }
    rootDrag.start(e, rowIdx);
  }

  // Source row metadata used for the DropGhost label/color so the
  // drop slot reads as the dragged row's own tile. Looks up the
  // row's rendered metadata from renderedRows so nestedWorkspaces use the
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
      const dashId = wsMeta(ws).dashboardNestedWorkspaceId;
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
  $: effectiveActive = dragActive || tabDragToRoot !== null;
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
    const srcWs = $nestedWorkspaces.find(
      (w) => w.id === tabDrag!.sourceWorkspaceId,
    );
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

  // --- NestedWorkspace row context menu (previously in WorkspaceListBlock's
  // showWorkspaceContextMenu; unchanged modulo re-scoping to rendered
  // root rows). ---
  function runPromoteToProject(globalIdx: number) {
    onSwitchWorkspace(globalIdx);
    const cmd = get(commandStore).find(
      (c) => c.id === "promote-nested-workspace-to-workspace",
    );
    if (cmd) void cmd.action();
  }

  $: canPromote = $commandStore.some(
    (c) => c.id === "promote-nested-workspace-to-workspace",
  );

  function showWorkspaceContextMenu(x: number, y: number, globalIdx: number) {
    const ws = $nestedWorkspaces[globalIdx];
    if (!ws) return;
    const md = wsMeta(ws);
    const isDashboard = md?.isDashboard === true;
    const isInsideWorkspace = typeof md?.parentWorkspaceId === "string";
    const isLocked = md?.locked === true;
    const items = buildWorkspaceContextMenuItems({
      isDashboard,
      isInsideWorkspace,
      canPromoteCommand: canPromote,
      workspaceCount: $nestedWorkspaces.length,
      isLocked,
      onRename: () => startRename(globalIdx),
      onNewSurface: () => {
        onSwitchWorkspace(globalIdx);
        onNewSurface();
      },
      onPromote: () => runPromoteToProject(globalIdx),
      onToggleLock: () => toggleWorkspaceLock(ws.id),
      onClose: () => void confirmAndCloseWorkspace(ws, globalIdx),
    });
    contextMenu.set({ x, y, items });
  }
</script>

<!-- No "Workspaces" label row here anymore. The label was redundant
     (there's only one root section), and the "+ New" split-button
     moved up into Sidebar's top row so it aligns with the
     other title-row buttons. -->

<!-- Root rows: nestedWorkspaces and whole project blocks interleaved per
     $rootRowOrder. Each row is shelled with a core-drawn DragGrip
     (left) + content (right). Non-source rows during a drag get a
     strong overlay with the row's own color + name centered. -->
{#each renderedRows as entry (entry.key)}
  {@const isSource = dragActive && dragSourceIdx === entry.idx}
  {@const _isSibling = effectiveActive && effectiveDragSourceIdx !== entry.idx}
  {@const ghostBefore =
    effectiveInsertIndicator?.idx === entry.idx &&
    effectiveInsertIndicator.edge === "before"}
  {@const ghostAfter =
    effectiveInsertIndicator?.idx === entry.idx &&
    effectiveInsertIndicator.edge === "after"}
  {@const ws = entry.workspace}
  {@const _dashId = ws ? wsMeta(ws).dashboardNestedWorkspaceId : undefined}
  {@const rowColor =
    entry.rendererRailColor ??
    (entry.pseudoWorkspace
      ? resolvePseudoWorkspaceColor(entry.pseudoWorkspace)
      : typeof _dashId === "string"
        ? ($dashboardWorkspaceRegistry.get(_dashId)?.accentColor ??
          $theme.accent)
        : $theme.accent)}
  {@const _rowFg = contrastColor(rowColor)}
  {@const _rowLabel =
    entry.row.kind === "nested-workspace" && ws
      ? ws.name
      : entry.row.kind === "pseudo-workspace" && entry.pseudoWorkspace
        ? entry.pseudoWorkspace.label
        : (entry.rendererLabel ?? "")}
  <!-- The DropGhost is a sibling .root-row, NOT a child of an existing
       row. The source row is fully skipped from rendering (not just
       inner display:none) — that lets the Ghost-row inherit the
       source's "first/last row" status via the natural .root-row +
       .root-row { margin-top: 8px } rule. Result: the ghost has the
       same 8px gaps to its neighbors as a real row would, AND the
       totals stay balanced (Ghost-row in slot K replaces source-row
       in slot K, including its margin-top contribution). -->
  {#if ghostBefore}
    <div class="root-row">
      <DropGhost
        theme={$theme}
        height={effectiveDragSourceHeight}
        accent={effectiveSourceRowColor}
        label={effectiveSourceRowLabel}
      />
    </div>
  {/if}
  {#if !isSource}
    <div class="root-row" data-root-row-container={entry.idx}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div data-root-row-idx={entry.idx} style="position: relative;">
        <!-- Row content — the renderer draws its OWN grip (via
             onGripMouseDown) so the row looks self-contained (no gap
             between active workspace bg and its rail, matching the
             nested-workspace style). Core still owns the drag pipeline
             — the renderer's grip just calls back into startRootRowDrag. -->
        {#if entry.row.kind === "nested-workspace" && ws}
          {@const globalIdx = $nestedWorkspaces.indexOf(ws)}
          <WorkspaceItem
            bind:this={workspaceItems[ws.id]}
            workspace={ws}
            index={globalIdx}
            isActive={globalIdx === $activeNestedWorkspaceIdx}
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
            onGripMouseDown={(e) => startRootRowDrag(e, entry.idx)}
          />
        {:else if entry.rendererComponent && entry.rendererSource}
          {@const extApi = getExtensionApiById(entry.rendererSource)}
          {#if extApi}
            <ExtensionWrapper
              api={extApi}
              component={entry.rendererComponent}
              props={{
                id: entry.row.id,
                onGripMouseDown: (e: MouseEvent) =>
                  startRootRowDrag(e, entry.idx),
                shortcutIdx: entry.workspaceOnlyIdx,
              }}
            />
          {/if}
        {/if}
      </div>
    </div>
  {/if}
  {#if ghostAfter}
    <div class="root-row">
      <DropGhost
        theme={$theme}
        height={effectiveDragSourceHeight}
        accent={effectiveSourceRowColor}
        label={effectiveSourceRowLabel}
      />
    </div>
  {/if}
{/each}

<style>
  /* Inter-row gap — matches the nested workspace inter-row gap
     (see WorkspaceListView's .workspace-list-row + rule) so root and
     nested lists share the same 8px vertical rhythm. */
  .root-row + .root-row {
    margin-top: 8px;
  }
</style>
