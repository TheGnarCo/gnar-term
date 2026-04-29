<script lang="ts">
  import type { Component } from "svelte";
  import { theme } from "../stores/theme";
  import { secondarySidebarVisible, secondarySidebarWidth } from "../stores/ui";
  import {
    sidebarTabStore,
    sidebarActionStore,
    sidebarTabBadgeStore,
    clearSidebarTabBadge,
    activeSidebarTabStore,
  } from "../services/sidebar-tab-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import { secondarySections } from "../stores/mcp-sidebar";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import McpSidebarSection from "./McpSidebarSection.svelte";
  import SidebarResizeHandle from "./SidebarResizeHandle.svelte";

  let activeTabId: string | null = null;

  // Auto-select first tab when tabs change
  $: if (
    $sidebarTabStore.length > 0 &&
    !$sidebarTabStore.find((t) => t.id === activeTabId)
  ) {
    activeTabId = $sidebarTabStore[0]!.id;
  }

  // Respond to programmatic tab activation requests
  $: if ($activeSidebarTabStore) {
    const requested = $activeSidebarTabStore;
    if ($sidebarTabStore.find((t) => t.id === requested)) {
      activeTabId = requested;
      clearSidebarTabBadge(requested);
      if (!$secondarySidebarVisible) {
        secondarySidebarVisible.set(true);
      }
    }
    activeSidebarTabStore.set(null);
  }

  $: activeTab = $sidebarTabStore.find((t) => t.id === activeTabId);
  $: activeActions = $sidebarActionStore.filter((a) => a.tabId === activeTabId);

  function selectTab(tabId: string) {
    activeTabId = tabId;
    clearSidebarTabBadge(tabId);
  }
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
    <SidebarResizeHandle
      direction="left"
      theme={$theme}
      onDrag={(clientX) => {
        const maxWidth = window.innerWidth * 0.33;
        secondarySidebarWidth.set(
          Math.max(140, Math.min(maxWidth, window.innerWidth - clientX)),
        );
      }}
    />
    <div
      style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"
    >
      <!-- Top row: tab bar -->
      <div
        role="tablist"
        data-tauri-drag-region=""
        style="
        height: 38px; display: flex; align-items: center;
        border-bottom: 1px solid {$theme.border};
        padding: 0 6px;
        overflow-x: auto; scrollbar-width: none;
        -webkit-app-region: drag;
      "
      >
        {#each $sidebarTabStore as tab (tab.id)}
          <button
            role="tab"
            aria-selected={activeTabId === tab.id}
            aria-controls="secondary-sidebar-tab-panel-{tab.id}"
            style="
            background: none; border: none; cursor: pointer;
            padding: 4px 10px; border-radius: 4px; font-size: 11px;
            color: {activeTabId === tab.id ? $theme.fg : $theme.fgDim};
            font-weight: {activeTabId === tab.id ? '600' : '400'};
            -webkit-app-region: no-drag;
            position: relative;
          "
            title={tab.label}
            on:click={() => selectTab(tab.id)}
          >
            {tab.label}
            {#if $sidebarTabBadgeStore[tab.id] && activeTabId !== tab.id}
              <span
                class="tab-badge"
                style="
                  position: absolute; top: 2px; right: 2px;
                  width: 6px; height: 6px; border-radius: 50%;
                  background: {$theme.notify};
                "
              ></span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Control row: tab-specific actions (only rendered when populated) -->
      {#if activeActions.length > 0}
        <div
          id="secondary-sidebar-controls"
          style="
          height: 28px; display: flex; align-items: center; gap: 2px;
          padding: 0 6px; flex-shrink: 0;
          background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
        "
        >
          {#each activeActions as action}
            <button
              style="
              background: none; border: none; cursor: pointer;
              padding: 2px 6px; border-radius: 4px; font-size: 11px;
              color: {$theme.fgDim};
            "
              title={action.title || action.actionId}
              on:click={action.handler}
              >{action.title || action.actionId}</button
            >
          {/each}
        </div>
      {/if}

      <!-- Content area -->
      <div
        role="tabpanel"
        id={activeTab
          ? `secondary-sidebar-tab-panel-${activeTab.id}`
          : undefined}
        aria-labelledby={activeTab ? activeTab.id : undefined}
        style="flex: 1; overflow-y: auto; display: flex; flex-direction: column;"
      >
        {#if activeTab}
          {@const tabApi = getExtensionApiById(activeTab.source)}
          {#key activeTab.id}
            {#if tabApi}
              <ExtensionWrapper api={tabApi} component={activeTab.component} />
            {:else}
              <svelte:component this={activeTab.component as Component} />
            {/if}
          {/key}
        {:else}
          <div
            style="flex: 1; display: flex; align-items: center; justify-content: center; padding: 8px;"
          >
            <span style="color: {$theme.fgDim}; font-size: 12px;"
              >No tabs registered</span
            >
          </div>
        {/if}

        <!-- MCP-declared sections (render_sidebar tool) -->
        {#each $secondarySections as section (section.sectionId)}
          <McpSidebarSection {section} />
        {/each}
      </div>
    </div>
  </div>
{/if}
