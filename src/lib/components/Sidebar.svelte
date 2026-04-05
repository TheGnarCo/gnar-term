<script lang="ts">
  import { theme } from "../stores/theme";
  import { sidebarVisible, contextMenu } from "../stores/ui";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import WorkspaceItem from "./WorkspaceItem.svelte";
  import type { MenuItem } from "../context-menu-types";

  export let onNewWorkspace: () => void;
  export let onSwitchWorkspace: (idx: number) => void;
  export let onCloseWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onSplitPane: (direction: "horizontal" | "vertical") => void;
  export let onNewSurface: () => void;
  export let onReorderWorkspaces: (fromIdx: number, toIdx: number) => void;

  let workspaceItems: Record<string, WorkspaceItem> = {};

  export function startRename(idx: number) {
    const ws = $workspaces[idx];
    if (ws && workspaceItems[ws.id]) {
      workspaceItems[ws.id].startRename();
    }
  }

  function showWorkspaceContextMenu(x: number, y: number, idx: number) {
    const items: MenuItem[] = [
      { label: "Rename Workspace", shortcut: "⇧⌘R", action: () => startRename(idx) },
      { label: "New Surface", shortcut: "⌘T", action: () => { onSwitchWorkspace(idx); onNewSurface(); } },
      { label: "Split Right", shortcut: "⌘D", action: () => { onSwitchWorkspace(idx); onSplitPane("horizontal"); } },
      { label: "Split Down", shortcut: "⇧⌘D", action: () => { onSwitchWorkspace(idx); onSplitPane("vertical"); } },
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

  let btnStyle = "";
  $: btnStyle = `
    background: none; border: none; color: ${$theme.fgMuted};
    border-radius: 4px; width: 26px; height: 26px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    padding: 0; -webkit-app-region: no-drag;
  `;
</script>

{#if $sidebarVisible}
  <div
    id="sidebar"
    style="
      width: 220px; min-width: 180px; max-width: 400px;
      background: {$theme.sidebarBg}; border-right: 1px solid {$theme.sidebarBorder};
      display: flex; flex-direction: column; overflow: hidden;
      font-size: 13px; user-select: none;
    "
  >
    <!-- Header toolbar -->
    <div
      data-tauri-drag-region=""
      style="
        height: 38px; padding: 0 6px 0 0; display: flex; align-items: center;
        justify-content: flex-end; gap: 2px;
        border-bottom: 1px solid {$theme.border};
        -webkit-app-region: drag;
      "
    >
      <button style={btnStyle} title="Hide Sidebar (⌘B)" on:click={() => sidebarVisible.set(false)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="12" rx="1.5"/><line x1="5.5" y1="2" x2="5.5" y2="14"/></svg>
      </button>
      <button style={btnStyle} title="Split Pane (⌘D)" on:click={() => onSplitPane("horizontal")}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="12" height="12" rx="1.5"/><line x1="7" y1="1" x2="7" y2="13"/></svg>
      </button>
      <button style={btnStyle} title="New workspace (⌘N)" on:click={onNewWorkspace}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="2" x2="7" y2="12"/><line x1="2" y1="7" x2="12" y2="7"/></svg>
      </button>
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
{/if}
