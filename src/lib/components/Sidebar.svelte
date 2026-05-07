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
  import CollapsedRailView from "./CollapsedRailView.svelte";
  import NewWorkspaceSplitButton from "./NewWorkspaceSplitButton.svelte";

  // Width of the rail-only slot when the sidebar is collapsed.
  // Matches the DragGrip frit-pattern width (8px).
  const RAIL_WIDTH_PX = 8;

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
  role="presentation"
  style="
    width: {$sidebarVisible ? `${$sidebarWidth}px` : `${RAIL_WIDTH_PX}px`};
    background: {$theme.sidebarBg};
    display: flex;
    overflow: {$sidebarVisible ? 'hidden' : 'visible'};
    font-size: 13px;
    flex-shrink: 0;
    position: relative;
  "
>
  {#if $sidebarVisible}
    <!-- Full sidebar content -->
    <div
      class="sidebar-content"
      style="width: 100%; height: 100%; display: flex; background: {$theme.sidebarBg};"
    >
      <div
        style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
      >
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

        <!-- Scrollable content: Workspaces section, extension sections,
             MCP sections. 4px left inset aligns row rails with the left
             edge stripe. -->
        <div style="flex: 1; overflow-y: auto; padding: 8px 0 8px 4px;">
          <WorkspaceListBlock bind:this={workspaceListBlock} />

          {#each $sidebarSectionStore as section (section.id)}
            <div aria-hidden="true" style="height: 16px;"></div>
            <SidebarSectionBlock
              {section}
              collapsed={collapsedSections[section.id] ?? false}
              onToggleCollapse={() =>
                (collapsedSections[section.id] =
                  !collapsedSections[section.id])}
            />
          {/each}

          {#each $primarySections as section (section.sectionId)}
            <McpSidebarSection {section} />
          {/each}
        </div>

        <ArchiveZone />
      </div>
      <SidebarResizeHandle
        direction="right"
        theme={$theme}
        onDrag={(clientX) => {
          const maxWidth = window.innerWidth * 0.33;
          sidebarWidth.set(Math.max(200, Math.min(maxWidth, clientX)));
        }}
      />
    </div>
  {:else}
    <!-- Collapsed: rail strips only. No archive, no dragging. -->
    <CollapsedRailView sidebarWidth={$sidebarWidth} />
  {/if}
</div>
