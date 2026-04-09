<script lang="ts">
  import { theme } from "../stores/theme";
  import { primarySidebarVisible, primarySidebarWidth, contextMenu } from "../stores/ui";
  import { dragResize } from "../actions/drag-resize";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import type { MenuItem } from "../context-menu-types";

  export let onNewWorkspace: () => void;
  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;
  export let onReorderWorkspaces: (fromIdx: number, toIdx: number) => void;

  let workspaceItems: Record<string, WorkspaceItem> = {};

  export function startRename(idx: number) {
    const ws = $workspaces[idx];
    if (ws && workspaceItems[ws.id]) {
      workspaceItems[ws.id].startRename();
    }
  }

  let dragging = false;

  function showWorkspaceContextMenu(x: number, y: number, idx: number) {
    const items: MenuItem[] = [
      { label: "Rename Workspace", shortcut: "⇧⌘R", action: () => startRename(idx) },
      { label: "New Surface", shortcut: "⌘T", action: () => { onSwitchWorkspace(idx); onNewSurface(); } },
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
      font-size: 13px; user-select: none;
      flex-shrink: 0;
    "
  >
  <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
    <!-- Top row: controls + drag region for window chrome -->
    <div
      data-tauri-drag-region=""
      style="
        height: 38px; flex-shrink: 0; display: flex; align-items: center;
        justify-content: flex-end; padding: 0 6px;
        -webkit-app-region: drag;
      "
    >
      <button
        title="New Workspace (⌘N)"
        style="
          background: none; border: none; cursor: pointer;
          width: 26px; height: 26px; border-radius: 4px;
          display: flex; align-items: center; justify-content: center;
          color: {$theme.fgDim}; font-size: 18px; line-height: 1;
          -webkit-app-region: no-drag;
        "
        on:click={onNewWorkspace}
      >+</button>
    </div>

    <!-- Workspace list -->
    <div style="flex: 1; overflow-y: auto; padding: 4px 0;">
      {#each $workspaces as ws, idx (ws.id)}
        <WorkspaceItem
          bind:this={workspaceItems[ws.id]}
          workspace={ws}
          index={idx}
          isActive={idx === $activeWorkspaceIdx}
          onSelect={() => onSwitchWorkspace(idx)}
          onClose={() => onCloseWorkspace(idx)}
          onRename={(name) => onRenameWorkspace(idx, name)}
          onContextMenu={(x, y) => showWorkspaceContextMenu(x, y, idx)}
          onReorder={onReorderWorkspaces}
        />
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
        primarySidebarWidth.set(Math.max(140, Math.min(maxWidth, ev.clientX)));
      },
      onStart: () => { dragging = true; },
      onEnd: () => { dragging = false; },
    }}
  ></div>
  </div>
{/if}

<style>
  .sidebar-resize-handle:hover {
    filter: brightness(1.3);
  }
</style>
