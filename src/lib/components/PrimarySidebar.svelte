<script lang="ts">
  /**
   * PrimarySidebar — thin host that mounts the Workspaces section
   * plus any extension-registered SidebarSectionBlocks / MCP
   * sections after it.
   *
   * Post Phase-B: the Workspaces section is fixed at the top and is
   * no longer user-draggable. Projects have folded into that section
   * as siblings of unclaimed nestedWorkspaces; the unified root-row drag
   * pipeline lives inside WorkspaceListBlock. Extension-registered
   * sections still render below it in their declared order but
   * aren't reorderable at the top level either.
   */
  import { theme } from "../stores/theme";
  import { primarySidebarVisible, primarySidebarWidth } from "../stores/ui";
  import { sidebarSectionStore } from "../services/sidebar-section-registry";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { primarySections } from "../stores/mcp-sidebar";
  import WorkspaceListBlock from "./WorkspaceListBlock.svelte";
  import SidebarSectionBlock from "./SidebarSectionBlock.svelte";
  import SidebarActionButton from "./SidebarActionButton.svelte";
  import McpSidebarSection from "./McpSidebarSection.svelte";
  import ArchiveZone from "./ArchiveZone.svelte";
  import SidebarResizeHandle from "./SidebarResizeHandle.svelte";

  const iconSvgMap: Record<string, string> = {
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    "folder-plus": `<path d="M2 4 L2 13 L14 13 L14 6 L8 6 L7 4 Z" fill="none" /><line x1="8" y1="8" x2="8" y2="12" /><line x1="6" y1="10" x2="10" y2="10" />`,
  };
  function iconSvg(icon: string): string {
    return iconSvgMap[icon] ?? "";
  }

  let collapsedSections: Record<string, boolean> = {};

  export let onSwitchWorkspace: (idx: number) => void;
  export let onRenameWorkspace: (idx: number, name: string) => void;
  export let onNewSurface: () => void;

  let workspaceListBlock: WorkspaceListBlock;

  // "New Workspace" (core-registered) is the primary action in the
  // Workspaces header "+ New" button.
  $: coreAction = $workspaceActionStore.find(
    (a) => a.id === "core:new-workspace",
  );
  $: sidebarZoneActions = $workspaceActionStore.filter(
    (a) => a.zone === "sidebar" && (!a.when || a.when({})),
  );

  export function startRename(idx: number) {
    workspaceListBlock?.startRename(idx);
  }
</script>

{#if $primarySidebarVisible}
  <div
    id="primary-sidebar"
    style="
      width: {$primarySidebarWidth}px;
      background: {$theme.sidebarBg};
      display: flex; overflow: hidden;
      font-size: 13px;
      flex-shrink: 0;
    "
  >
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Top row: traffic-light spacer + any sidebar-zone actions.
           Always 38px so the sidebar's "+ New" and zone actions stay
           reachable in every window mode, including native fullscreen
           where the OS title bar is gone. The window-drag attributes
           are harmless no-ops when there's no window to drag. -->
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
        {#if coreAction}
          <span
            class="top-row-new-chip"
            style="
              flex-shrink: 0; border-radius: 6px; overflow: visible;
              background: {$theme.bgHighlight ??
              $theme.bgFloat ??
              'rgba(0, 0, 0, 0.3)'};
              box-shadow: inset 0 0 0 1px {$theme.border ?? 'transparent'};
              --section-btn-fg: {$theme.fg};
              -webkit-app-region: no-drag;
            "
          >
            <button
              style="
                -webkit-app-region: no-drag;
                background: transparent; border: none;
                color: {$theme.fg}; cursor: pointer;
                font-size: 12px; padding: 4px 10px;
              "
              on:click={() => coreAction?.handler({})}
            >
              + New
            </button>
          </span>
        {/if}
        {#each sidebarZoneActions as action (action.id)}
          <SidebarActionButton
            title={action.label}
            onClick={() => action.handler({})}
            theme={$theme}
            svgContent={iconSvg(action.icon)}
          />
        {/each}
      </div>

      <!-- Scrollable content: the Workspaces section (which includes
           pseudo-workspace rows via rootRowOrder), any extension-registered
           SidebarSectionBlocks, and MCP-declared sections — in that order.
           4px left inset gives a dark strip between the sidebar's left edge
           and each row's rail. 8px top inset keeps the first row's rounded
           corner from butting up against the "+ New" chrome above. -->
      <div style="flex: 1; overflow-y: auto; padding: 8px 0 8px 4px;">
        <WorkspaceListBlock
          bind:this={workspaceListBlock}
          {onSwitchWorkspace}
          {onRenameWorkspace}
          {onNewSurface}
        />

        <!-- Extension-registered sections (legacy registerPrimarySidebarSection
             API). 16px gap above each so they breathe below the Workspaces
             block. -->
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

      <ArchiveZone />
    </div>
    <SidebarResizeHandle
      direction="right"
      theme={$theme}
      onDrag={(clientX) => {
        const maxWidth = window.innerWidth * 0.33;
        primarySidebarWidth.set(Math.max(140, Math.min(maxWidth, clientX)));
      }}
    />
  </div>
{/if}

<style>
  /* Top-row "+ New" chip — hover tint matches the rest of the top-row buttons. */
  .top-row-new-chip button:hover {
    background: rgba(255, 255, 255, 0.08) !important;
  }
</style>
