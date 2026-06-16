<script lang="ts">
  import { theme } from "../stores/theme";
  import { sidebarVisible, sidebarWidth } from "../stores/ui";
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { extensionSections } from "../stores/extension-sidebar";
  import WorkspaceList from "./WorkspaceList.svelte";
  import SidebarResizeHandle from "./SidebarResizeHandle.svelte";
  import ExtensionSidebarSection from "./ExtensionSidebarSection.svelte";

  export let onNewWorkspace: () => void;
  // The list owns selection/close/rename/reorder internally via the
  // workspace services (members + anchors), but these callbacks are kept
  // for API stability with App.svelte. `onReorderWorkspaces` is absorbed
  // by WorkspaceList's own drag pipeline.
  export let onSwitchWorkspace: (idx: number) => void = () => {};
  export let onCloseWorkspace: (idx: number) => void = () => {};
  export let onRenameWorkspace: (idx: number, name: string) => void = () => {};
  export let onNewSurface: () => void = () => {};
  export let onReorderWorkspaces: (fromIdx: number, toIdx: number) => void = () => {};
  // Referenced so the absorbed/stable callbacks don't trip unused-var lint.
  void onSwitchWorkspace;
  void onCloseWorkspace;
  void onRenameWorkspace;
  void onNewSurface;
  void onReorderWorkspaces;

  let workspaceListEl: WorkspaceList;

  /**
   * Start an inline rename on the active workspace's row. Kept for the
   * ⇧⌘R shortcut wired in App.svelte. Rename now lives inside the tree
   * components (anchor/member rows own their own contentEditable), so the
   * Sidebar delegates by id rather than reaching into a flat row map.
   */
  export function startRename(_idx: number) {
    const ws = $workspaces[$activeWorkspaceIdx];
    if (!ws) return;
    workspaceListEl?.startRenameForWorkspace?.(ws.id);
  }
</script>

{#if $sidebarVisible}
  <!-- Expanded: a normal flex column taking sidebarWidth. -->
  <div
    id="sidebar"
    style="
      position: relative;
      width: {$sidebarWidth}px;
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

      <!-- Workspace tree (always first) + extension sections -->
      <div class="workspace-list" style="flex: 1; overflow-y: auto; padding: 4px 0;">
        <WorkspaceList bind:this={workspaceListEl} />
        {#each $extensionSections as section (section.sectionId)}
          <ExtensionSidebarSection {section} />
        {/each}
      </div>
    </div>
    <SidebarResizeHandle
      direction="right"
      theme={$theme}
      onDrag={(clientX) => {
        const maxWidth = window.innerWidth * 0.33;
        sidebarWidth.set(Math.max(140, Math.min(maxWidth, clientX)));
      }}
    />
  </div>
{:else}
  <!-- Collapsed: a 12px absolute rail strip overlaying the left edge.
       Each anchor row's colored rail clips to this strip; hovering a
       row's rail surfaces its full anchor row as a portaled popover
       (owned by WorkspaceList). -->
  <div
    id="sidebar"
    style="
      position: absolute; left: 0; top: 0; bottom: 0;
      width: 12px;
      z-index: 2;
      background: {$theme.sidebarBg};
      display: flex; flex-direction: column; overflow: hidden;
      font-size: 13px; user-select: none;
    "
  >
    <div style="height: 38px; flex-shrink: 0;" data-tauri-drag-region=""></div>
    <div class="workspace-list" style="flex: 1; overflow: hidden; padding: 4px 0;">
      <WorkspaceList bind:this={workspaceListEl} />
    </div>
  </div>
{/if}
