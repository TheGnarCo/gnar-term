<script lang="ts">
  import { theme } from "../stores/theme";
  import { secondarySidebarVisible, secondarySidebarWidth } from "../stores/ui";
  import { dragResize } from "../actions/drag-resize";

  let dragging = false;
</script>

{#if $secondarySidebarVisible}
  <div
    id="secondary-sidebar"
    style="
      width: {$secondarySidebarWidth}px;
      background: {$theme.sidebarBg};
      display: flex; overflow: hidden;
      font-size: 13px; user-select: none;
      flex-shrink: 0;
    "
  >
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
        secondarySidebarWidth.set(Math.max(140, Math.min(maxWidth, window.innerWidth - ev.clientX)));
      },
      onStart: () => { dragging = true; },
      onEnd: () => { dragging = false; },
    }}
  ></div>
  <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
    <!-- Top row: tab bar -->
    <div
      data-tauri-drag-region=""
      style="
        height: 38px; display: flex; align-items: center;
        border-bottom: 1px solid {$theme.border};
        padding: 0 6px;
        overflow-x: auto; scrollbar-width: none;
        -webkit-app-region: drag;
      "
    >
      <!-- Tab area (scrollable, future tabs go here) -->
    </div>

    <!-- Control row: plugin-supplied quick actions (only rendered when populated) -->
    {#if $$slots.controls}
      <div
        id="secondary-sidebar-controls"
        style="
          height: 28px; display: flex; align-items: center; gap: 2px;
          padding: 0 6px; flex-shrink: 0;
          background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
        "
      >
        <slot name="controls" />
      </div>
    {/if}

    <!-- Content area -->
    <div style="flex: 1; overflow-y: auto; padding: 8px; display: flex; align-items: center; justify-content: center;">
      <span style="color: {$theme.fgDim}; font-size: 12px;">No Secondary Sidebar Content</span>
    </div>
  </div>
  </div>
{/if}

<style>
  .sidebar-resize-handle:hover {
    filter: brightness(1.3);
  }
</style>
