<script lang="ts">
  /**
   * WorkspaceListBlock — core-owned renderer of the Workspaces
   * section. Iterates the unified rootRowOrder store and renders each
   * row with a core-drawn grip column on the left.
   *
   * Row kinds:
   *   - "workspace"  → unclaimed workspace, rendered via WorkspaceItem
   *                    (with onGripMouseDown OMITTED — this block draws
   *                    the grip externally so every root row has a
   *                    uniform rail regardless of kind).
   *   - other        → looked up from rootRowRendererStore (projects
   *                    register "project" as a renderer on activate).
   *
   * This block OWNS the drag pipeline for the root list. Renderers
   * inherit drag behavior — they do not spin up their own reorder
   * logic at the root level. Nested pipelines (a project's own
   * workspace list) are unchanged and still live inside
   * WorkspaceListView.
   */
  import { flip } from "svelte/animate";
  import { derived, get } from "svelte/store";
  import { theme } from "../stores/theme";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { contextMenu, reorderContext, anyReorderActive } from "../stores/ui";
  import {
    rootRowOrder,
    moveRootRow,
    type RootRow,
  } from "../stores/root-row-order";
  import { rootRowRendererStore } from "../services/root-row-renderer-registry";
  import { claimedWorkspaceIds } from "../services/claimed-workspace-registry";
  import { createDragReorder } from "../actions/drag-reorder";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import DropGhost from "./DropGhost.svelte";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import { getExtensionApiById } from "../services/extension-loader";
  import { contrastColor } from "../utils/contrast";
  import type { MenuItem } from "../context-menu-types";
  import type { Workspace } from "../types";
  import { commandStore } from "../services/command-registry";

  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
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
  };
  // Use `derived()` (not a `$:` IIFE) so Svelte's store-subscription
  // plumbing tracks the sources explicitly. An earlier attempt wrapped
  // the computation in a `$:` IIFE and the dependencies weren't
  // detected reliably across HMR.
  const renderedRowsStore = derived(
    [workspaces, rootRowOrder, rootRowRendererStore, claimedWorkspaceIds],
    ([$ws, $order, $renderers, $claimed]) => {
      const rows: RenderedRow[] = [];
      const byId = new Map(
        $ws
          .filter((ws) => !$claimed.has(ws.id))
          .map((ws) => [ws.id, ws] as const),
      );
      const renderers = new Map($renderers.map((r) => [r.id, r] as const));
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

  const rootDrag = createDragReorder({
    dataAttr: "root-row-idx",
    containerSelector: "#primary-sidebar",
    ghostStyle: () => ({
      background: $theme.bgFloat ?? $theme.bgSurface ?? "#111",
      border: `1px solid ${$theme.border ?? "transparent"}`,
    }),
    canStart: () => !$anyReorderActive,
    onDrop: (from, to) => moveRootRow(from, to),
    onStateChange: () => {
      const s = rootDrag.getState();
      dragSourceIdx = s.sourceIdx;
      insertIndicator = s.indicator;
      dragActive = s.active;
      dragSourceHeight = s.sourceHeight;
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
  $: sourceRowColor = sourceEntry?.rendererRailColor ?? $theme.accent;
  $: sourceRowLabel =
    sourceEntry?.rendererLabel ?? sourceEntry?.workspace?.name ?? "";

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
    const workspaceCount = $workspaces.length;
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        shortcut: "⇧⌘R",
        action: () => startRename(globalIdx),
      },
      {
        label: "New Surface",
        shortcut: "⌘T",
        action: () => {
          onSwitchWorkspace(globalIdx);
          onNewSurface();
        },
      },
      ...(canPromote
        ? [
            { label: "", action: () => {}, separator: true } as MenuItem,
            {
              label: "Promote to Workspace Group...",
              action: () => runPromoteToProject(globalIdx),
            } as MenuItem,
          ]
        : []),
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Other Workspaces",
        disabled: workspaceCount <= 1,
        action: () => {
          // Close all other workspaces by global idx, walking back-to-front
          // so indices stay valid as we splice.
          for (let i = $workspaces.length - 1; i >= 0; i--) {
            if (i !== globalIdx) onCloseWorkspace(i);
          }
        },
      },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: workspaceCount <= 1,
        action: () => onCloseWorkspace(globalIdx),
      },
    ];
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
  {@const isSibling = dragActive && dragSourceIdx !== entry.idx}
  {@const ws = entry.workspace}
  {@const rowColor = entry.rendererRailColor ?? $theme.accent}
  {@const rowFg = contrastColor(rowColor)}
  {@const rowLabel =
    entry.row.kind === "workspace" && ws
      ? ws.name
      : (entry.rendererLabel ?? "")}
  <div class="root-row" animate:flip={{ duration: 200 }}>
    {#if insertIndicator?.idx === entry.idx && insertIndicator.edge === "before"}
      <DropGhost
        theme={$theme}
        height={dragSourceHeight}
        accent={sourceRowColor}
        label={sourceRowLabel}
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
          isActive={globalIdx === $activeWorkspaceIdx}
          dragActive={isSource}
          onSelect={() => {
            if (!dragActive) onSwitchWorkspace(globalIdx);
          }}
          onClose={() => onCloseWorkspace(globalIdx)}
          onRename={(name) => onRenameWorkspace(globalIdx, name)}
          onContextMenu={(x, y) => showWorkspaceContextMenu(x, y, globalIdx)}
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
            }}
          />
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
    {#if insertIndicator?.idx === entry.idx && insertIndicator.edge === "after"}
      <DropGhost
        theme={$theme}
        height={dragSourceHeight}
        accent={sourceRowColor}
        label={sourceRowLabel}
      />
    {/if}
  </div>
{/each}

<style>
  /* Inter-row gap — matches the nested workspace inter-row gap
     (see WorkspaceListView's .workspace-list-row + rule). Bumped
     from 2px so root workspaces breathe visually the same way
     nested ones do. */
  .root-row + .root-row {
    margin-top: 6px;
  }
</style>
