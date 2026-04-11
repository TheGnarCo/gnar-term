<script lang="ts">
  import { flip } from "svelte/animate";
  import { theme } from "../stores/theme";
  import {
    primarySidebarVisible,
    primarySidebarWidth,
    contextMenu,
  } from "../stores/ui";
  import { dragResize } from "../actions/drag-resize";
  import { createDragReorder } from "../actions/drag-reorder";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import type { MenuItem } from "../context-menu-types";
  import { sidebarSectionStore } from "../services/sidebar-section-registry";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { claimedWorkspaceIds } from "../services/claimed-workspace-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";

  // SVG icon definitions for workspace actions — all variations on the "+" shape
  const iconSvgMap: Record<string, string> = {
    // Plain plus
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    // Plus with small branch fork (bottom-right corner)
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    // Plus with small folder tab (top-right corner)
    "folder-plus": `<line x1="7" y1="3" x2="7" y2="11" /><line x1="3" y1="7" x2="11" y2="7" /><path d="M10 2 L12 2 L13 3 L15 3 L15 5 L10 5 Z" fill="currentColor" opacity="0.6" />`,
  };

  let collapsedSections: Record<string, boolean> = {};

  // Filter out workspaces claimed by extensions (e.g., project-scope).
  // Track original indices for callbacks that need global store positions.
  $: unclaimedEntries = $workspaces
    .map((ws, idx) => ({ ws, idx }))
    .filter(({ ws }) => !$claimedWorkspaceIds.has(ws.id));

  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;
  export let onReorderWorkspaces: (fromIdx: number, toIdx: number) => void;

  let workspaceItems: Record<string, WorkspaceItem> = {};

  // --- Section reorder mode ---
  let sectionReorderMode = false;

  // --- Block ordering (workspaces + extension sections as reorderable blocks) ---
  // blockOrder stores ids: "__workspaces__" for the workspace block,
  // section ids for extension sections. When sections change, we sync.
  type SidebarBlock =
    | { type: "workspaces"; id: "__workspaces__" }
    | { type: "section"; id: string };

  let blockOrder: string[] = ["__workspaces__"];

  // Sync blockOrder when sections change: add new sections, remove stale ones
  $: {
    const sectionIds = $sidebarSectionStore.map((s) => s.id);
    const existing = new Set(blockOrder);
    const current = new Set(["__workspaces__", ...sectionIds]);
    // Remove blocks that no longer exist
    blockOrder = blockOrder.filter((id) => current.has(id));
    // Add new sections not yet in order (at the end)
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
    const ws = $workspaces[idx];
    if (ws && workspaceItems[ws.id]) {
      workspaceItems[ws.id].startRename();
    }
  }

  let dragging = false;

  // --- Drag & drop reordering (shared utility — HTML5 DnD broken in Tauri WKWebView) ---

  const ghostStyle = () => ({
    background: $theme.bgFloat ?? $theme.bgSurface,
    border: `1px solid ${$theme.accent}`,
  });

  // Workspace item drag
  let dragSourceIdx: number | null = null;
  let insertIndicator: { idx: number; edge: "before" | "after" } | null = null;
  let dragActive = false;

  const workspaceDrag = createDragReorder({
    dataAttr: "drag-idx",
    containerSelector: "#primary-sidebar",
    ghostStyle,
    onDrop: (from, to) => {
      onReorderWorkspaces(from, to);
      syncWorkspaceDragState();
    },
  });

  function startDrag(e: MouseEvent, idx: number) {
    workspaceDrag.start(e, idx);
    syncWorkspaceDragState();
    // Track mouse moves to sync reactive state
    if (e.button === 0) {
      const syncAndClean = () => {
        syncWorkspaceDragState();
        if (!dragActive) {
          window.removeEventListener("mousemove", syncMove);
          window.removeEventListener("mouseup", syncAndClean);
        }
      };
      const syncMove = () => syncWorkspaceDragState();
      window.addEventListener("mousemove", syncMove);
      window.addEventListener("mouseup", syncAndClean);
    }
  }

  function syncWorkspaceDragState() {
    const s = workspaceDrag.getState();
    dragSourceIdx = s.sourceIdx;
    insertIndicator = s.indicator;
    dragActive = s.active;
  }

  // Block (section) drag
  let blockDragSourceIdx: number | null = null;
  let blockInsertIndicator: { idx: number; edge: "before" | "after" } | null =
    null;
  let blockDragActive = false;

  const blockDrag = createDragReorder({
    dataAttr: "block-idx",
    containerSelector: "#primary-sidebar",
    ghostStyle,
    canStart: () => sectionReorderMode,
    onDrop: (from, to) => {
      const next = [...blockOrder];
      const [item] = next.splice(from, 1);
      const insertAt = to > from ? to - 1 : to;
      next.splice(insertAt, 0, item);
      blockOrder = next;
      syncBlockDragState();
    },
  });

  function startBlockDrag(e: MouseEvent, blockIdx: number) {
    blockDrag.start(e, blockIdx);
    syncBlockDragState();
    if (e.button === 0 && sectionReorderMode) {
      const syncAndClean = () => {
        syncBlockDragState();
        if (!blockDragActive) {
          window.removeEventListener("mousemove", syncMove);
          window.removeEventListener("mouseup", syncAndClean);
        }
      };
      const syncMove = () => syncBlockDragState();
      window.addEventListener("mousemove", syncMove);
      window.addEventListener("mouseup", syncAndClean);
    }
  }

  function syncBlockDragState() {
    const s = blockDrag.getState();
    blockDragSourceIdx = s.sourceIdx;
    blockInsertIndicator = s.indicator;
    blockDragActive = s.active;
  }

  function showWorkspaceContextMenu(x: number, y: number, idx: number) {
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        shortcut: "⇧⌘R",
        action: () => startRename(idx),
      },
      {
        label: "New Surface",
        shortcut: "⌘T",
        action: () => {
          onSwitchWorkspace(idx);
          onNewSurface();
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Close Other Workspaces",
        disabled: $workspaces.length <= 1,
        action: () => {
          for (let i = $workspaces.length - 1; i >= 0; i--) {
            if (i !== idx) onCloseWorkspace(i);
          }
        },
      },
      {
        label: "Close Workspace",
        shortcut: "⇧⌘W",
        danger: true,
        disabled: $workspaces.length <= 1,
        action: () => onCloseWorkspace(idx),
      },
    ];
    contextMenu.set({ x, y, items });
  }
</script>

{#if $primarySidebarVisible}
  <div
    id="primary-sidebar"
    style="
      width: {$primarySidebarWidth}px;
      background: {$theme.sidebarBg};
      display: flex; overflow: hidden;
      font-size: 13px; user-select: {dragActive ? 'none' : 'auto'};
      flex-shrink: 0;
    "
  >
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Top row: controls + drag region for window chrome -->
      <div
        data-tauri-drag-region=""
        style="
        height: 38px; flex-shrink: 0; display: flex; align-items: center;
        justify-content: flex-end; padding: 0 6px; gap: 2px;
        -webkit-app-region: drag;
      "
      >
        {#if $sidebarSectionStore.length >= 1}
          <button
            data-action="reorder-sections"
            title={sectionReorderMode
              ? "Done reordering"
              : "Reorder sidebar sections"}
            on:click={() => (sectionReorderMode = !sectionReorderMode)}
            style="
              background: {sectionReorderMode ? $theme.bgHighlight : 'none'};
              border: none; cursor: pointer;
              width: 26px; height: 26px; border-radius: 4px;
              display: flex; align-items: center; justify-content: center;
              color: {sectionReorderMode ? $theme.accent : $theme.fgDim};
              -webkit-app-region: no-drag;
            "
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="5,1 5,15" />
              <polyline points="3,3 5,1 7,3" />
              <polyline points="11,1 11,15" />
              <polyline points="9,13 11,15 13,13" />
            </svg>
          </button>
        {/if}
        {#each $workspaceActionStore as action (action.id)}
          <button
            title={action.shortcut
              ? `${action.label} (${action.shortcut})`
              : action.label}
            style="
            background: none; border: none; cursor: pointer;
            width: 26px; height: 26px; border-radius: 4px;
            display: flex; align-items: center; justify-content: center;
            color: {$theme.fgDim};
            -webkit-app-region: no-drag;
          "
            on:click={() => action.handler({})}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              {@html iconSvgMap[action.icon] ?? iconSvgMap["plus"]}
            </svg>
          </button>
        {/each}
      </div>

      <!-- Scrollable content: blocks rendered in order -->
      <div style="flex: 1; overflow-y: auto; padding: 4px 0;">
        {#each orderedBlocks as block, bIdx (block.id)}
          <div animate:flip={{ duration: 200 }}>
            {#if sectionReorderMode && blockInsertIndicator?.idx === bIdx && blockInsertIndicator.edge === "before"}
              <div
                style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
              ></div>
            {/if}

            <div
              data-block-idx={bIdx}
              style="position: relative;
                opacity: {blockDragActive && blockDragSourceIdx === bIdx
                ? 0.4
                : 1};
                {bIdx > 0 ? `margin-top: 4px;` : ''}"
            >
              <!-- Block content (always rendered for natural height) -->
              {#if block.type === "workspaces"}
                {#if !sectionReorderMode}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  {#each unclaimedEntries as entry, _i (entry.ws.id)}
                    {@const ws = entry.ws}
                    {@const idx = entry.idx}
                    <div animate:flip={{ duration: 200 }}>
                      {#if insertIndicator?.idx === idx && insertIndicator.edge === "before"}
                        <div
                          style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
                        ></div>
                      {/if}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div on:mousedown={(e) => startDrag(e, idx)}>
                        <WorkspaceItem
                          bind:this={workspaceItems[ws.id]}
                          workspace={ws}
                          index={idx}
                          isActive={idx === $activeWorkspaceIdx}
                          dragActive={dragActive && dragSourceIdx === idx}
                          onSelect={() => {
                            if (!dragActive) onSwitchWorkspace(idx);
                          }}
                          onClose={() => onCloseWorkspace(idx)}
                          onRename={(name) => onRenameWorkspace(idx, name)}
                          onContextMenu={(x, y) =>
                            showWorkspaceContextMenu(x, y, idx)}
                        />
                      </div>
                      {#if insertIndicator?.idx === idx && insertIndicator.edge === "after"}
                        <div
                          style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
                        ></div>
                      {/if}
                    </div>
                  {/each}
                {:else}
                  <!-- Reorder mode: render workspace items but muted -->
                  {#each unclaimedEntries as entry (entry.ws.id)}
                    <div style="opacity: 0.3; pointer-events: none;">
                      <WorkspaceItem
                        workspace={entry.ws}
                        index={0}
                        isActive={false}
                        dragActive={false}
                        onSelect={() => {}}
                        onClose={() => {}}
                        onRename={() => {}}
                        onContextMenu={() => {}}
                      />
                    </div>
                  {/each}
                {/if}
              {:else}
                {@const section = $sidebarSectionStore.find(
                  (s) => s.id === block.id,
                )}
                {#if section}
                  {#if !sectionReorderMode && section.showLabel !== false}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                      style="
                        padding: 6px 12px; font-size: 10px; font-weight: 600;
                        letter-spacing: 0.5px; text-transform: uppercase;
                        color: {$theme.fgDim};
                        cursor: {section.collapsible !== false
                        ? 'pointer'
                        : 'default'};
                        display: flex; align-items: center; gap: 4px;
                      "
                      on:click={() => {
                        if (section.collapsible !== false)
                          collapsedSections[section.id] =
                            !collapsedSections[section.id];
                      }}
                    >
                      {#if section.collapsible !== false}
                        <span
                          style="font-size: 8px; transform: rotate({collapsedSections[
                            section.id
                          ]
                            ? '-90deg'
                            : '0'}); transition: transform 0.15s;">&#9660;</span
                        >
                      {/if}
                      {section.label}
                    </div>
                  {/if}
                  {#if section.collapsible === false || !collapsedSections[section.id] || sectionReorderMode}
                    {@const sectionApi = getExtensionApiById(section.source)}
                    <div
                      style={sectionReorderMode
                        ? "opacity: 0.3; pointer-events: none;"
                        : ""}
                    >
                      {#if sectionApi}
                        <ExtensionWrapper
                          api={sectionApi}
                          component={section.component}
                          props={section.props ?? {}}
                        />
                      {:else if typeof section.component === "function"}
                        <svelte:component this={section.component} />
                      {/if}
                    </div>
                  {/if}
                {/if}
              {/if}

              <!-- Reorder overlay: drag handle + label -->
              {#if sectionReorderMode}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  data-section-drag={block.id}
                  on:mousedown={(e) => startBlockDrag(e, bIdx)}
                  style="
                    position: absolute; inset: 0;
                    display: flex; align-items: center; justify-content: flex-start;
                    padding-left: 12px; gap: 8px; cursor: grab;
                    background: {$theme.sidebarBg}cc;
                    border-radius: 6px;
                  "
                >
                  <svg
                    width="10"
                    height="14"
                    viewBox="0 0 10 14"
                    fill={$theme.fgDim}
                    style="flex-shrink: 0;"
                  >
                    <circle cx="3" cy="3" r="1.2" />
                    <circle cx="7" cy="3" r="1.2" />
                    <circle cx="3" cy="7" r="1.2" />
                    <circle cx="7" cy="7" r="1.2" />
                    <circle cx="3" cy="11" r="1.2" />
                    <circle cx="7" cy="11" r="1.2" />
                  </svg>
                  <span
                    style="font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
                      text-transform: uppercase; color: {$theme.fg};
                      flex: 1; text-align: center;"
                  >
                    {#if block.type === "workspaces"}
                      Workspaces
                    {:else}
                      {$sidebarSectionStore.find((s) => s.id === block.id)
                        ?.label ?? block.id}
                    {/if}
                  </span>
                </div>
              {/if}
            </div>

            {#if sectionReorderMode && blockInsertIndicator?.idx === bIdx && blockInsertIndicator.edge === "after"}
              <div
                style="height: 2px; background: {$theme.accent}; margin: 0 12px; border-radius: 1px;"
              ></div>
            {/if}
          </div>
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
