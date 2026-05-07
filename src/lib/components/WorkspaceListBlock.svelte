<script lang="ts">
  /**
   * WorkspaceListBlock — core-owned renderer of the Workspaces
   * section. Iterates the unified rootRowOrder store and renders each
   * row with a core-drawn grip column on the left.
   *
   * Row kinds:
   *   - "workspace"        → Root Workspace, rendered via the registered renderer (chips)
   *   - "pseudo-workspace" → pinned extension row rendered via PseudoWorkspaceRow
   *   - other              → looked up from rootRowRendererStore.
   *
   * This block OWNS the drag pipeline for the root list. Renderers
   * inherit drag behavior — they do not spin up their own reorder
   * logic at the root level. Nested pipelines (a Workspace's own
   * Branch list) are unchanged and still live inside
   * WorkspaceListView.
   */
  import { derived } from "svelte/store";
  import { onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import {
    reorderContext,
    canSidebarDrag,
    sidebarVisible,
    sidebarWidth,
    hoveredRootRowKey,
  } from "../stores/ui";
  import {
    rootRowOrder,
    moveRootRow,
    type RootRow,
  } from "../stores/root-row-order";
  import { rootRowRendererStore } from "../services/root-row-renderer-registry";
  import {
    pseudoWorkspaceStore,
    type PseudoWorkspace,
  } from "../services/pseudo-workspace-registry";
  import { createDragReorder } from "../actions/drag-reorder";
  import PseudoWorkspaceRow from "./PseudoWorkspaceRow.svelte";
  import DropGhost from "./DropGhost.svelte";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import { getExtensionApiById } from "../services/extension-loader";
  import {
    switchWorkspace,
    closeWorkspace,
  } from "../services/workspace-runtime-service";
  import { activeWorkspaceIdx } from "../stores/workspace";

  import { type Workspace } from "../types";
  import {
    detectWorkspacePaneDrop,
    setWorkspaceDragState,
    createDragDenyOverlay,
    removeDragDenyOverlay,
    type WorkspacePaneDropTarget,
  } from "../services/workspace-drag";
  import { configStore } from "../config";
  import { resolveWorkspaceColor } from "../theme-data";
  import { archiveWorkspace } from "../services/archive-service";
  import { getWorkspace } from "../stores/workspace";

  function resolvePseudoWorkspaceColor(pw: PseudoWorkspace): string {
    const slot = $configStore.pseudoWorkspaceColors?.[pw.id] ?? "purple";
    return resolveWorkspaceColor(slot, $theme);
  }

  // Sidebar exposes a "rename active" keyboard shortcut, but Root
  // workspaces rename through WorkspaceSectionContent's banner label
  // and Branches go through WorkspaceListView — there is no bare row
  // mounted here. The shortcut is a no-op at this surface; the
  // Sidebar.startRename function stays for API stability.
  export function startRename(_globalIdx: number) {
    // Intentional no-op — see comment above.
  }

  // Derived view: rootRowOrder as-is plus per-row metadata we need at
  // render time (source workspace for workspace rows, renderer
  // component for other kinds). Rows whose referent is missing are
  // skipped — this tolerates stale persisted entries that outlived
  // their owning Workspace. Workspaces present in the store but
  // NOT in rootRowOrder are auto-appended at render time: this covers
  // first-run installs (empty persisted order), direct
  // `workspaces.set` in tests, and any path that skips the service
  // helpers.
  type RenderedRow = {
    row: RootRow;
    idx: number;
    key: string;
    rendererComponent?: unknown;
    rendererSource?: string;
    rendererRailColor?: string;
    rendererLabel?: string;
    pseudoWorkspace?: PseudoWorkspace;
    workspaceOnlyIdx?: number;
    /**
     * Set when the row represents a standalone Dashboard Workspace
     * (created via `spawnOrNavigate` from a `registerDashboardWorkspace`
     * button — Settings, Claude Settings, etc.). These have
     * `isDashboard: true`, `dashboardContributionId`, and no
     * `rootWorkspaceId`. The registered "workspace" renderer (built for
     * `WorkspaceRecord` rows with paths and branches) can't draw them, so
     * the block routes them through `WorkspaceItem` directly.
     */
    standaloneDashboardWs?: Workspace;
  };
  // Use `derived()` (not a `$:` IIFE) so Svelte's store-subscription
  // plumbing tracks the sources explicitly. An earlier attempt wrapped
  // the computation in a `$:` IIFE and the dependencies weren't
  // detected reliably across HMR.
  const renderedRowsStore = derived(
    [rootRowOrder, rootRowRendererStore, pseudoWorkspaceStore, workspaces],
    ([$order, $renderers, $pseudoWs, $workspaces]) => {
      const rows: RenderedRow[] = [];
      const renderers = new Map($renderers.map((r) => [r.id, r] as const));
      const pseudoById = new Map($pseudoWs.map((pw) => [pw.id, pw] as const));
      const wsById = new Map($workspaces.map((w) => [w.id, w] as const));
      let workspaceCount = 0;
      $order.forEach((row, idx) => {
        const key = `${row.kind}:${row.id}`;
        if (row.kind === "pseudo-workspace") {
          const pw = pseudoById.get(row.id);
          if (!pw) return;
          rows.push({ row, idx, key, pseudoWorkspace: pw });
          return;
        }
        if (row.kind === "workspace") {
          // Standalone Dashboard Workspaces (no rootWorkspaceId,
          // isDashboard) bypass the registered "workspace" renderer and
          // render via WorkspaceItem so the dashboard's icon, accent
          // color, and label come from `dashboardWorkspaceRegistry`.
          // Dashboard chips are NOT addressable via ⌘N — only core
          // workspace banners participate in the numbered shortcut, so
          // the dashboard row gets no `workspaceOnlyIdx` and the count
          // stays aligned with `keyboard-shortcuts.ts`'s filter.
          const ws = wsById.get(row.id);
          if (
            ws &&
            ws.isDashboard === true &&
            typeof ws.rootWorkspaceId !== "string"
          ) {
            rows.push({
              row,
              idx,
              key,
              standaloneDashboardWs: ws,
            });
            return;
          }
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
      return rows;
    },
  );
  $: renderedRows = $renderedRowsStore;

  // --- Per-row popover (collapsed sidebar only) ---
  //
  // When the sidebar is collapsed, hovering an individual row's rail
  // surfaces THAT row's full banner as an absolutely-positioned popover
  // anchored at the row's y-coordinate. Other rails stay 12px-clipped.
  // The hovered row's key drives both the popover render here AND the
  // shared `hoveredRootRowKey` store so peer chrome (status badges, etc.)
  // can react.
  const POPOVER_GRACE_MS = 150;

  let popoverRow: { key: string; top: number; height: number } | null = null;
  let popoverGraceTimer: ReturnType<typeof setTimeout> | null = null;

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
    popoverRow = { key, top: rect.top, height: rect.height };
    hoveredRootRowKey.set(key);
  }

  function clearPopoverWithGrace() {
    if ($sidebarVisible) return;
    clearPopoverGraceTimer();
    popoverGraceTimer = setTimeout(() => {
      popoverRow = null;
      hoveredRootRowKey.set(null);
      popoverGraceTimer = null;
    }, POPOVER_GRACE_MS);
  }

  // Drop the popover whenever the sidebar expands so it doesn't linger
  // after the user toggles state mid-hover.
  $: if ($sidebarVisible) {
    clearPopoverGraceTimer();
    popoverRow = null;
    if ($hoveredRootRowKey !== null) hoveredRootRowKey.set(null);
  }

  onDestroy(() => {
    clearPopoverGraceTimer();
    if ($hoveredRootRowKey !== null) hoveredRootRowKey.set(null);
  });

  // --- Unified drag pipeline for the root list ---
  //
  // One createDragReorder owns reordering across all root rows
  // (Workspaces and pinned extension rows alike). The dataAttr
  // "root-row-idx" tags each rendered row
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
    containerSelector: "#sidebar",
    ghostStyle: () => ({
      background: "transparent",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    canStart: () => $canSidebarDrag,
    onDrop: (from, to) => moveRootRow(from, to),
    onMove: (x, y, ghostEl) => {
      const fromIdx = rootDrag.getState().sourceIdx;
      if (fromIdx === null) return;
      // Archive zone hit-test runs for all row kinds (branch AND
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
    if (srcRow?.kind === "workspace") {
      const workspace = getWorkspace(srcRow.id);
      if (workspace?.locked === true) return;
    }
    rootDrag.start(e, rowIdx);
  }

  // Source row metadata used for the DropGhost label/color so the
  // drop slot reads as the dragged row's own tile. Looks up the
  // row's rendered metadata from renderedRows so Workspaces use the
  // theme accent / Workspace name, and pinned extension rows use the
  // color + name via the registered railColor/label resolvers.
  $: sourceRow =
    dragActive && dragSourceIdx !== null ? $rootRowOrder[dragSourceIdx] : null;
  $: sourceEntry =
    sourceRow != null
      ? renderedRows.find(
          (e) => e.row.kind === sourceRow!.kind && e.row.id === sourceRow!.id,
        )
      : undefined;
  $: sourceRowColor =
    sourceEntry?.rendererRailColor ??
    (sourceEntry?.pseudoWorkspace
      ? resolvePseudoWorkspaceColor(sourceEntry.pseudoWorkspace)
      : $theme.accent);
  $: sourceRowLabel =
    sourceEntry?.pseudoWorkspace?.label ?? sourceEntry?.rendererLabel ?? "";

  $: effectiveActive = dragActive;
  $: effectiveDragSourceIdx = dragSourceIdx;
  $: effectiveInsertIndicator = insertIndicator;
  $: effectiveDragSourceHeight = dragSourceHeight;
  $: effectiveSourceRowLabel = sourceRowLabel;
  $: effectiveSourceRowColor = sourceRowColor;
</script>

<!-- No "Workspaces" label row here anymore. The label was redundant
     (there's only one root section), and the "+ New" split-button
     moved up into Sidebar's top row so it aligns with the
     other title-row buttons. -->

{#snippet rowBody(entry: RenderedRow)}
  {#if entry.row.kind === "pseudo-workspace" && entry.pseudoWorkspace}
    <PseudoWorkspaceRow
      pseudo={entry.pseudoWorkspace}
      onGripMouseDown={(e) => startRootRowDrag(e, entry.idx)}
    />
  {:else if entry.standaloneDashboardWs}
    {@const ws = entry.standaloneDashboardWs}
    {@const globalIdx = $workspaces.findIndex((w) => w.id === ws.id)}
    <WorkspaceItem
      workspace={ws}
      index={globalIdx}
      isActive={globalIdx === $activeWorkspaceIdx}
      onSelect={() => {
        if (globalIdx >= 0) switchWorkspace(globalIdx);
      }}
      onClose={() => {
        if (globalIdx >= 0) closeWorkspace(globalIdx);
      }}
      onRename={() => {}}
      onContextMenu={() => {}}
      onGripMouseDown={(e) => startRootRowDrag(e, entry.idx)}
      dragActive={false}
      shortcutIdx={entry.workspaceOnlyIdx}
    />
  {:else if entry.rendererComponent && entry.rendererSource}
    {@const extApi = getExtensionApiById(entry.rendererSource)}
    {#if extApi}
      <ExtensionWrapper
        api={extApi}
        component={entry.rendererComponent}
        props={{
          id: entry.row.id,
          onGripMouseDown: (e: MouseEvent) => startRootRowDrag(e, entry.idx),
          shortcutIdx: entry.workspaceOnlyIdx,
        }}
      />
    {/if}
  {/if}
{/snippet}

<!-- Root rows: Workspaces and pinned extension blocks interleaved per
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
  {@const _rowColor =
    entry.rendererRailColor ??
    (entry.pseudoWorkspace
      ? resolvePseudoWorkspaceColor(entry.pseudoWorkspace)
      : $theme.accent)}
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
      <div
        data-root-row-idx={entry.idx}
        data-root-row-key={entry.key}
        style="position: relative;"
        on:mouseenter={(e) => setPopoverFromEvent(e, entry.key)}
        on:mouseleave={clearPopoverWithGrace}
      >
        {@render rowBody(entry)}
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

{#if !$sidebarVisible && popoverRow}
  {@const popoverEntry = renderedRows.find((r) => r.key === popoverRow!.key)}
  {#if popoverEntry}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="root-row-popover"
      data-root-row-popover={popoverEntry.key}
      style="
        position: fixed;
        top: {popoverRow.top}px;
        left: 0;
        width: {$sidebarWidth}px;
        z-index: 200;
        pointer-events: auto;
        background: transparent;
      "
      on:mouseenter={clearPopoverGraceTimer}
      on:mouseleave={clearPopoverWithGrace}
    >
      {@render rowBody(popoverEntry)}
    </div>
  {/if}
{/if}

<style>
  /* Inter-row gap — matches the child workspace inter-row gap
     (see WorkspaceListView's .workspace-list-row + rule) so root and
     nested lists share the same 8px vertical rhythm. */
  .root-row + .root-row {
    margin-top: 8px;
  }
</style>
