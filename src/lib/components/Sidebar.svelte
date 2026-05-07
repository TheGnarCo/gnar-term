<script lang="ts">
  /**
   * Sidebar — thin host that mounts the Workspaces section
   * plus any extension-registered SidebarSectionBlocks / MCP
   * sections after it.
   *
   * Post Phase-B: the Workspaces section is fixed at the top and is
   * no longer user-draggable. All Workspaces and Branches render in
   * that single section; the unified root-row drag pipeline lives
   * inside WorkspaceListBlock. Extension-registered sections still
   * render below it in their declared order but aren't reorderable
   * at the top level either.
   */
  import { onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { sidebarVisible, sidebarWidth } from "../stores/ui";
  import { sidebarSectionStore } from "../services/sidebar-section-registry";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { primarySections } from "../stores/mcp-sidebar";
  import WorkspaceListBlock from "./WorkspaceListBlock.svelte";
  import SidebarSectionBlock from "./SidebarSectionBlock.svelte";
  import SidebarActionButton from "./SidebarActionButton.svelte";
  import McpSidebarSection from "./McpSidebarSection.svelte";
  import ArchiveZone from "./ArchiveZone.svelte";
  import SidebarResizeHandle from "./SidebarResizeHandle.svelte";
  import NewWorkspaceSplitButton from "./NewWorkspaceSplitButton.svelte";

  // Brief grace period so users can drift off the slot for a moment
  // (e.g. catching the OS scrollbar) without the overlay flashing shut.
  const HOVER_CLOSE_DELAY_MS = 150;

  // Width of the rail-only slot when the sidebar is collapsed. The
  // workspace banner's grip rail is 8px (DragGrip frit pattern); show
  // it plus a few pixels of banner past the rail so the colour stripe
  // is visible without revealing row content.
  const RAIL_WIDTH_PX = 12;

  let overlayActive = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearCloseTimer() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function handleSlotEnter() {
    if ($sidebarVisible) return;
    clearCloseTimer();
    overlayActive = true;
  }

  function handleSlotLeave() {
    if ($sidebarVisible) return;
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      overlayActive = false;
      closeTimer = null;
    }, HOVER_CLOSE_DELAY_MS);
  }

  // Reset overlay state whenever the sidebar expands so the overlay
  // doesn't linger after the user toggles it back open.
  $: if ($sidebarVisible) {
    clearCloseTimer();
    overlayActive = false;
  }

  onDestroy(clearCloseTimer);

  const iconSvgMap: Record<string, string> = {
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    "folder-plus": `<path d="M2 4 L2 13 L14 13 L14 6 L8 6 L7 4 Z" fill="none" /><line x1="8" y1="8" x2="8" y2="12" /><line x1="6" y1="10" x2="10" y2="10" />`,
    search: `<circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13" y2="13" />`,
    "question-mark": `<path d="M5.5 5.5 a2.5 2.5 0 1 1 3.5 2.3 c-1 0.5 -1 1.2 -1 2.2" /><circle cx="8" cy="12.5" r="0.6" fill="currentColor" stroke="none" />`,
  };
  function iconSvg(icon: string): string {
    return iconSvgMap[icon] ?? "";
  }

  let collapsedSections: Record<string, boolean> = {};

  let workspaceListBlock: WorkspaceListBlock;

  $: sidebarZoneActions = $workspaceActionStore.filter(
    (a) => a.zone === "sidebar" && (!a.when || a.when({})),
  );

  export function startRename(idx: number) {
    workspaceListBlock?.startRename(idx);
  }
</script>

<div
  id="sidebar"
  class:collapsed={!$sidebarVisible}
  class:overlay-active={!$sidebarVisible && overlayActive}
  on:mouseenter={handleSlotEnter}
  on:mouseleave={handleSlotLeave}
  role="presentation"
  style="
    width: {$sidebarVisible ? `${$sidebarWidth}px` : `${RAIL_WIDTH_PX}px`};
    background: {$sidebarVisible ? $theme.sidebarBg : 'transparent'};
    display: flex;
    overflow: hidden;
    font-size: 13px;
    flex-shrink: 0;
    position: relative;
  "
>
  <!-- In collapsed mode the inner content is absolutely positioned at
       its full natural width but clipped by the rail slot's
       overflow: hidden — exposing only the leftmost RAIL_WIDTH_PX
       pixels of each row, which is where the workspace grip rail and
       a sliver of the banner colour live. Hovering lifts the clip so
       the full sidebar opens over the terminal. -->
  <div
    class="sidebar-content"
    style="
      width: {$sidebarVisible ? '100%' : `${$sidebarWidth}px`};
      height: 100%;
      display: flex;
      background: {$sidebarVisible ? $theme.sidebarBg : 'transparent'};
      transition: box-shadow 120ms ease;
      {$sidebarVisible ? '' : 'position: absolute; left: 0; top: 0;'}
    "
  >
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Top row: traffic-light spacer + any sidebar-zone actions.
           Always 38px so the sidebar's "+ New" and zone actions stay
           reachable in every window mode, including native fullscreen
           where the OS title bar is gone. The window-drag attributes
           are harmless no-ops when there's no window to drag.
           Hidden in collapsed mode — the "+ New" split button moves to
           the TitleBar (Task 5) and zone actions reappear when the
           overlay opens (Task 4). -->
      {#if $sidebarVisible}
        <div
          data-tauri-drag-region=""
          style="
            height: 38px;
            flex-shrink: 0;
            display: flex; align-items: center; justify-content: flex-end;
            padding: 0 6px; gap: 4px;
            overflow: visible;
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
          <NewWorkspaceSplitButton />
        </div>
      {/if}

      <!-- Scrollable content: the Workspaces section (which includes
           pseudo-workspace rows via rootRowOrder), any extension-registered
           SidebarSectionBlocks, and MCP-declared sections — in that order.
           4px left inset gives a dark strip between the sidebar's left edge
           and each row's rail. 8px top inset keeps the first row's rounded
           corner from butting up against the "+ New" chrome above. -->
      <div style="flex: 1; overflow-y: auto; padding: 8px 0 8px 4px;">
        <WorkspaceListBlock bind:this={workspaceListBlock} />

        <!-- Extension-registered sections (registerSidebarSection API).
             16px gap above each so they breathe below the Workspaces block. -->
        {#each $sidebarSectionStore as section (section.id)}
          <div aria-hidden="true" style="height: 16px;"></div>
          <SidebarSectionBlock
            {section}
            collapsed={collapsedSections[section.id] ?? false}
            onToggleCollapse={() =>
              (collapsedSections[section.id] = !collapsedSections[section.id])}
          />
        {/each}

        <!-- MCP-declared sections (render_sidebar tool). -->
        {#each $primarySections as section (section.sectionId)}
          <McpSidebarSection {section} />
        {/each}
      </div>

      {#if $sidebarVisible}
        <ArchiveZone />
      {/if}
    </div>
    {#if $sidebarVisible}
      <SidebarResizeHandle
        direction="right"
        theme={$theme}
        onDrag={(clientX) => {
          const maxWidth = window.innerWidth * 0.33;
          // 200px clears the macOS traffic-light cluster (~78px) plus the
          // right-aligned "+ New" split button (~90px) without overlap.
          sidebarWidth.set(Math.max(200, Math.min(maxWidth, clientX)));
        }}
      />
    {/if}
  </div>
</div>
