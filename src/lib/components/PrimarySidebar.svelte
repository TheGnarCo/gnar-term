<script lang="ts">
  import { flip } from "svelte/animate";
  import { theme } from "../stores/theme";
  import {
    primarySidebarVisible,
    primarySidebarWidth,
    isFullscreen,
    innerReorderActive,
  } from "../stores/ui";
  import { dragResize } from "../actions/drag-resize";
  import { createDragReorder } from "../actions/drag-reorder";
  import { workspaces } from "../stores/workspace";
  import type { SplitButtonItem } from "./SplitButton.svelte";
  import { sidebarSectionStore } from "../services/sidebar-section-registry";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { claimedWorkspaceIds } from "../services/claimed-workspace-registry";
  import { primarySections } from "../stores/mcp-sidebar";
  import WorkspaceListBlock from "./WorkspaceListBlock.svelte";
  import SidebarSectionBlock from "./SidebarSectionBlock.svelte";
  import SidebarActionButton from "./SidebarActionButton.svelte";
  import McpSidebarSection from "./McpSidebarSection.svelte";
  import DragGrip from "./DragGrip.svelte";

  const iconSvgMap: Record<string, string> = {
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    "folder-plus": `<path d="M2 4 L2 13 L14 13 L14 6 L8 6 L7 4 Z" fill="none" /><line x1="8" y1="8" x2="8" y2="12" /><line x1="6" y1="10" x2="10" y2="10" />`,
  };
  function iconSvg(icon: string): string {
    return iconSvgMap[icon] ?? "";
  }

  let collapsedSections: Record<string, boolean> = {};

  $: unclaimedEntries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => !$claimedWorkspaceIds.has(ws.id));

  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;
  export let onReorderWorkspaces: (fromIdx: number, toIdx: number) => void;

  let workspaceListBlock: WorkspaceListBlock;

  $: coreAction = $workspaceActionStore.find(
    (a) => a.id === "core:new-workspace",
  );
  $: workspaceZoneActions = $workspaceActionStore.filter(
    (a) =>
      a.id !== "core:new-workspace" &&
      a.zone !== "sidebar" &&
      (!a.when || a.when({})),
  );
  $: sidebarZoneActions = $workspaceActionStore.filter(
    (a) => a.zone === "sidebar" && (!a.when || a.when({})),
  );

  $: splitDropdownItems = (() => {
    if (workspaceZoneActions.length === 0) return [];
    const items: SplitButtonItem[] = [];
    if (coreAction) {
      items.push({
        id: coreAction.id,
        label: coreAction.label,
        icon: coreAction.icon,
        handler: () => coreAction!.handler({}),
      });
    }
    for (const a of workspaceZoneActions) {
      items.push({
        id: a.id,
        label: a.label,
        icon: a.icon,
        handler: () => a.handler({}),
      });
    }
    return items;
  })();

  // --- Block ordering (workspaces + extension sections as reorderable blocks) ---
  type SidebarBlock =
    | { type: "workspaces"; id: "__workspaces__" }
    | { type: "section"; id: string };

  let blockOrder: string[] = ["__workspaces__"];

  $: {
    const sectionIds = $sidebarSectionStore.map((s) => s.id);
    const existing = new Set(blockOrder);
    const current = new Set(["__workspaces__", ...sectionIds]);
    blockOrder = blockOrder.filter((id) => current.has(id));
    for (const id of sectionIds) {
      if (!existing.has(id)) {
        blockOrder = [...blockOrder, id];
      }
    }
  }

  $: orderedBlocks = blockOrder.map((id): SidebarBlock => {
    if (id === "__workspaces__") return { type: "workspaces", id };
    return { type: "section", id };
  });

  export function startRename(idx: number) {
    workspaceListBlock?.startRename(idx);
  }

  let dragging = false;

  // --- Drag & drop reordering (shared utility — HTML5 DnD broken in Tauri WKWebView) ---

  const ghostStyle = () => ({
    background: $theme.bgFloat ?? $theme.bgSurface,
    border: `1px solid ${$theme.accent}`,
  });

  /**
   * Start a drag. State sync happens via the handle's onStateChange callback
   * (wired at construction), so callers don't need to re-subscribe here.
   */
  function createDragStarter(handle: ReturnType<typeof createDragReorder>) {
    return (e: MouseEvent, idx: number) => handle.start(e, idx);
  }

  // Workspace item drag
  let dragSourceIdx: number | null = null;
  let insertIndicator: { idx: number; edge: "before" | "after" } | null = null;
  let dragActive = false;

  const workspaceDrag = createDragReorder({
    dataAttr: "drag-idx",
    containerSelector: "#primary-sidebar",
    ghostStyle,
    onDrop: (from, to) => onReorderWorkspaces(from, to),
    onStateChange: () => syncWorkspaceDrag(),
  });

  function syncWorkspaceDrag() {
    const s = workspaceDrag.getState();
    dragSourceIdx = s.sourceIdx;
    insertIndicator = s.indicator;
    dragActive = s.active;
    innerReorderActive.set(s.active);
  }

  const startDrag = createDragStarter(workspaceDrag);

  // Block (section) drag
  let blockDragSourceIdx: number | null = null;
  let blockInsertIndicator: { idx: number; edge: "before" | "after" } | null =
    null;
  let blockDragActive = false;
  let hoverBlockIdx: number | null = null;

  const blockDrag = createDragReorder({
    dataAttr: "block-idx",
    containerSelector: "#primary-sidebar",
    ghostStyle,
    // Suppress block-level drag while any inner (row-level) drag is in flight.
    canStart: () => !$innerReorderActive,
    onDrop: (from, to) => {
      const next = [...blockOrder];
      const [item] = next.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      if (item) next.splice(insertAt, 0, item);
      blockOrder = next;
    },
    onStateChange: () => syncBlockDrag(),
  });

  function syncBlockDrag() {
    const s = blockDrag.getState();
    blockDragSourceIdx = s.sourceIdx;
    blockInsertIndicator = s.indicator;
    blockDragActive = s.active;
  }

  const startBlockDrag = createDragStarter(blockDrag);
</script>

{#if $primarySidebarVisible}
  <div
    id="primary-sidebar"
    style="
      width: {$primarySidebarWidth}px;
      background: {$theme.sidebarBg};
      display: flex; overflow: hidden;
      font-size: 13px; user-select: {dragActive || blockDragActive
      ? 'none'
      : 'auto'};
      flex-shrink: 0;
    "
  >
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Top row: traffic-light padding + any sidebar-zone actions. Hidden when
           fullscreen since neither the traffic lights nor window drag region
           are needed. -->
      {#if !$isFullscreen}
        <div
          data-tauri-drag-region=""
          style="
          height: 38px; flex-shrink: 0; display: flex; align-items: center;
          justify-content: flex-end; padding: 0 6px; gap: 4px;
          -webkit-app-region: drag;
        "
        >
          {#each sidebarZoneActions as action (action.id)}
            <SidebarActionButton
              title={action.label}
              onClick={() => action.handler({})}
              theme={$theme}
              svgContent={iconSvg(action.icon)}
            />
          {/each}
        </div>
      {/if}

      <!-- Scrollable content: blocks rendered in order -->
      <div style="flex: 1; overflow-y: auto; padding: 0;">
        {#each orderedBlocks as block, bIdx (block.id)}
          <div animate:flip={{ duration: 200 }}>
            {#if blockInsertIndicator?.idx === bIdx && blockInsertIndicator.edge === "before"}
              <div
                style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
              ></div>
            {/if}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              data-block-idx={bIdx}
              style="
                display: flex;
                position: relative;
                opacity: {blockDragActive && blockDragSourceIdx === bIdx
                ? 0.4
                : 1};
                {bIdx > 0 ? 'margin-top: 4px;' : ''}
              "
            >
              <div
                on:mouseenter={() => (hoverBlockIdx = bIdx)}
                on:mouseleave={() => (hoverBlockIdx = null)}
                style="flex-shrink: 0; align-self: stretch; display: flex;"
              >
                <DragGrip
                  theme={$theme}
                  visible={!$innerReorderActive &&
                    (hoverBlockIdx === bIdx ||
                      (blockDragActive && blockDragSourceIdx === bIdx))}
                  onMouseDown={(e) => startBlockDrag(e, bIdx)}
                  ariaLabel="Drag block to reorder"
                />
              </div>
              <div style="flex: 1; min-width: 0;">
                {#if block.type === "workspaces"}
                  <WorkspaceListBlock
                    bind:this={workspaceListBlock}
                    {unclaimedEntries}
                    {coreAction}
                    {splitDropdownItems}
                    {insertIndicator}
                    {dragActive}
                    {dragSourceIdx}
                    onStartDrag={startDrag}
                    {onSwitchWorkspace}
                    {onCloseWorkspace}
                    {onRenameWorkspace}
                    {onNewSurface}
                  />
                {:else}
                  {@const section = $sidebarSectionStore.find(
                    (s) => s.id === block.id,
                  )}
                  {#if section}
                    <SidebarSectionBlock
                      {section}
                      collapsed={collapsedSections[section.id] ?? false}
                      onToggleCollapse={() =>
                        (collapsedSections[section.id] =
                          !collapsedSections[section.id])}
                    />
                  {/if}
                {/if}
              </div>
            </div>

            {#if blockInsertIndicator?.idx === bIdx && blockInsertIndicator.edge === "after"}
              <div
                style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
              ></div>
            {/if}
          </div>
        {/each}

        <!-- MCP-declared sections (render_sidebar tool) -->
        {#each $primarySections as section (section.sectionId)}
          <McpSidebarSection {section} />
        {/each}
      </div>
    </div>
    <div
      class="sidebar-resize-handle"
      style="
      width: 4px; cursor: col-resize; flex-shrink: 0;
      background: {dragging ? $theme.accent : $theme.sidebarBorder};
      transition: background 0.15s;
    "
      use:dragResize={{
        onDrag: (ev) => {
          const maxWidth = window.innerWidth * 0.33;
          primarySidebarWidth.set(
            Math.max(140, Math.min(maxWidth, ev.clientX)),
          );
        },
        onStart: () => {
          dragging = true;
        },
        onEnd: () => {
          dragging = false;
        },
      }}
    ></div>
  </div>
{/if}

<style>
  .sidebar-resize-handle:hover {
    filter: brightness(1.3);
  }
</style>
