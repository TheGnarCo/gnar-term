<script lang="ts">
  /**
   * Body for the Global Agentic Dashboard pseudo-workspace.
   *
   * Renders a two-tab surface:
   *   - Overview — the live markdown preview with embedded
   *     `gnar:*` widgets (kanban / agent-list / task-spawner). A
   *     synthetic preview-surface entry carries the global
   *     `DashboardHostContext` through to widgets mounted via the
   *     markdown previewer's detached `mount()` tree.
   *   - Settings — color picker for the sidebar row + the configured
   *     markdown path indicator.
   */
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { setDashboardHost } from "../../../lib/contexts/dashboard-host";
  import {
    registerPreviewSurface,
    unregisterPreviewSurface,
  } from "../../../lib/services/preview-surface-registry";
  import {
    openPreview,
    type PreviewResult,
  } from "../../../lib/services/preview-service";
  import { getConfig, saveConfig, configStore } from "../../../lib/config";
  import { theme } from "../../../lib/stores/theme";
  import {
    PROJECT_COLOR_SLOTS,
    resolveProjectColor,
  } from "../../../lib/theme-data";

  const DEFAULT_TEMPLATE = `# Agents

Every detected agent in gnar-term.

\`\`\`gnar:kanban
\`\`\`

\`\`\`gnar:agent-list
title: Active Agents
\`\`\`
`;

  const PSEUDO_ID = "agentic.global";
  const hostMetadata = { isGlobalAgenticDashboard: true };
  const surfaceId = `pseudo.agentic.global:${Math.random().toString(36).slice(2, 8)}`;

  setDashboardHost({ metadata: hostMetadata });

  let container: HTMLElement;
  let loadError: string | null = null;
  let result: PreviewResult | null = null;
  let activeTab: "overview" | "settings" = "overview";
  let markdownPathResolved = "";

  $: currentColorSlot =
    $configStore.pseudoWorkspaceColors?.[PSEUDO_ID] ?? "purple";

  async function resolveMarkdownPath(): Promise<string> {
    const configured = getConfig().agenticGlobal?.markdownPath?.trim();
    if (configured) return configured;
    const home = await invoke<string>("get_home").catch(() => "");
    const root = home ? `${home}/.config/gnar-term` : ".config/gnar-term";
    return `${root}/global-agents.md`;
  }

  async function ensureMarkdownPath(): Promise<string> {
    const path = await resolveMarkdownPath();
    const exists = await invoke<boolean>("file_exists", { path }).catch(
      () => false,
    );
    if (!exists) {
      const dir = path.replace(/\/[^/]+$/, "");
      await invoke("ensure_dir", { path: dir }).catch(() => {});
      await invoke("write_file", {
        path,
        content: DEFAULT_TEMPLATE,
      }).catch(() => {});
    }
    return path;
  }

  onMount(async () => {
    try {
      markdownPathResolved = await ensureMarkdownPath();
      registerPreviewSurface({
        surfaceId,
        path: markdownPathResolved,
        paneId: "",
        workspaceId: "",
        hostMetadata,
      });
      result = await openPreview(markdownPathResolved, { surfaceId });
      container.appendChild(result.element);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  onDestroy(() => {
    result?.dispose?.();
    if (result?.watchId && result.watchId > 0) {
      invoke("unwatch_file", { watchId: result.watchId }).catch(() => {});
    }
    unregisterPreviewSurface(surfaceId);
  });

  async function selectColor(slot: string): Promise<void> {
    const existing = getConfig().pseudoWorkspaceColors ?? {};
    await saveConfig({
      pseudoWorkspaceColors: { ...existing, [PSEUDO_ID]: slot },
    });
  }
</script>

<div
  data-global-agentic-dashboard
  style="
    flex: 1; min-width: 0; min-height: 0;
    display: flex; flex-direction: column;
    background: {$theme.bg}; color: {$theme.fg};
  "
>
  <div
    role="tablist"
    aria-label="Global Agentic Dashboard sections"
    data-global-agentic-dashboard-tabs
    style="
      flex-shrink: 0;
      display: flex; align-items: stretch; gap: 4px;
      padding: 0 12px; border-bottom: 1px solid {$theme.border};
      background: {$theme.bgSurface};
    "
  >
    {#each [{ id: "overview" as const, label: "Overview" }, { id: "settings" as const, label: "Settings" }] as tab (tab.id)}
      {@const isActive = activeTab === tab.id}
      <button
        role="tab"
        id="global-agentic-dashboard-tab-{tab.id}"
        aria-selected={isActive}
        aria-controls="global-agentic-dashboard-panel-{tab.id}"
        tabindex={isActive ? 0 : -1}
        data-global-agentic-dashboard-tab={tab.id}
        data-active={isActive ? "true" : undefined}
        on:click={() => (activeTab = tab.id)}
        style="
          padding: 8px 16px;
          background: transparent;
          color: {isActive ? $theme.fg : $theme.fgDim};
          border: none;
          border-bottom: 2px solid {isActive ? $theme.accent : 'transparent'};
          font-size: 13px; font-weight: {isActive ? 600 : 500};
          cursor: pointer;
        "
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Overview pane: always mounted so the preview's live-reload
       subscription + host-context wiring stays intact across tab
       switches. `display: none` hides it when Settings is active. -->
  <div
    bind:this={container}
    role="tabpanel"
    id="global-agentic-dashboard-panel-overview"
    aria-labelledby="global-agentic-dashboard-tab-overview"
    aria-hidden={activeTab !== "overview"}
    data-preview-surface-id={surfaceId}
    data-global-agentic-dashboard-overview
    style="
      flex: 1; min-width: 0; min-height: 0; overflow: auto;
      display: {activeTab === 'overview' ? 'flex' : 'none'};
      flex-direction: column;
    "
  >
    {#if loadError}
      <div
        data-global-agentic-dashboard-error
        style="padding: 16px; font-family: monospace; font-size: 13px;"
      >
        {loadError}
      </div>
    {/if}
  </div>

  {#if activeTab === "settings"}
    <div
      role="tabpanel"
      id="global-agentic-dashboard-panel-settings"
      aria-labelledby="global-agentic-dashboard-tab-settings"
      data-global-agentic-dashboard-settings
      style="
        flex: 1; min-width: 0; min-height: 0; overflow: auto;
        padding: 24px 32px; display: flex; flex-direction: column; gap: 24px;
      "
    >
      <section style="display: flex; flex-direction: column; gap: 8px;">
        <h3 style="margin: 0; font-size: 14px; font-weight: 600;">
          Sidebar row color
        </h3>
        <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
          Pick a color for the Agents row in the primary sidebar.
        </p>
        <div
          data-color-picker
          role="radiogroup"
          style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;"
        >
          {#each PROJECT_COLOR_SLOTS as slot (slot)}
            {@const hex = resolveProjectColor(slot, $theme)}
            {@const isSelected = slot === currentColorSlot}
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-color-slot={slot}
              data-selected={isSelected ? "true" : undefined}
              title={slot}
              on:click={() => void selectColor(slot)}
              style="
                width: 32px; height: 32px; border-radius: 6px;
                background: {hex};
                border: 2px solid {isSelected ? $theme.fg : 'transparent'};
                cursor: pointer;
                padding: 0;
              "
              aria-label={`Select ${slot}`}
            ></button>
          {/each}
        </div>
      </section>

      <section style="display: flex; flex-direction: column; gap: 4px;">
        <h3 style="margin: 0; font-size: 14px; font-weight: 600;">
          Markdown source
        </h3>
        <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
          Backing file for this dashboard's Overview tab. Edit the path in
          Settings → Extensions → Agentic Orchestrator.
        </p>
        <code
          data-markdown-path
          style="
            margin-top: 4px; padding: 6px 10px;
            background: {$theme.bgSurface}; border: 1px solid {$theme.border};
            border-radius: 4px; font-size: 12px;
          ">{markdownPathResolved || "(resolving…)"}</code
        >
      </section>
    </div>
  {/if}
</div>
