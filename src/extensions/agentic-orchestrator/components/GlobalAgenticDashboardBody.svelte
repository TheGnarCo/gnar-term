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
  import { showConfirmPrompt } from "../../../lib/stores/ui";
  import { theme } from "../../../lib/stores/theme";
  import {
    GROUP_COLOR_SLOTS,
    resolveGroupColor,
    type GroupColorSlot,
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
  let regenerating = false;
  let regenerateError = "";

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

  function handleTablistKeydown(event: KeyboardEvent): void {
    const TABS: Array<"overview" | "settings"> = ["overview", "settings"];
    const idx = TABS.indexOf(activeTab);
    let nextIdx: number | null = null;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextIdx = (idx + 1) % TABS.length;
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nextIdx = (idx - 1 + TABS.length) % TABS.length;
    }
    if (nextIdx !== null) {
      const nextTab = TABS[nextIdx]!;
      activeTab = nextTab;
      document
        .getElementById(`global-agentic-dashboard-tab-${nextTab}`)
        ?.focus();
    }
  }

  async function handleColorKeydown(event: KeyboardEvent): Promise<void> {
    const slots = GROUP_COLOR_SLOTS;
    const idx = slots.indexOf(currentColorSlot as GroupColorSlot);
    let nextIdx: number | null = null;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextIdx = (idx + 1) % slots.length;
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nextIdx = (idx - 1 + slots.length) % slots.length;
    }
    if (nextIdx !== null) {
      const nextSlot = slots[nextIdx]!;
      await selectColor(nextSlot);
      document
        .querySelector<HTMLElement>(`[data-color-slot="${nextSlot}"]`)
        ?.focus();
    }
  }

  async function regenerateDashboard(): Promise<void> {
    const confirmed = await showConfirmPrompt(
      "Regenerate the Global Agents dashboard? Any custom edits to its markdown will be lost.",
      {
        title: "Regenerate Dashboard",
        confirmLabel: "Regenerate",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    regenerating = true;
    regenerateError = "";
    try {
      await invoke("write_file", {
        path: markdownPathResolved,
        content: DEFAULT_TEMPLATE,
      });
    } catch (err) {
      regenerateError = `Failed to regenerate: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      regenerating = false;
    }
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
    tabindex="-1"
    data-global-agentic-dashboard-tabs
    on:keydown={handleTablistKeydown}
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
          tabindex="-1"
          on:keydown={handleColorKeydown}
          style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;"
        >
          {#each GROUP_COLOR_SLOTS as slot (slot)}
            {@const hex = resolveGroupColor(slot, $theme)}
            {@const isSelected = slot === currentColorSlot}
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-color-slot={slot}
              data-selected={isSelected ? "true" : undefined}
              tabindex={isSelected ? 0 : -1}
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

      <section style="display: flex; flex-direction: column; gap: 8px;">
        <h3 style="margin: 0; font-size: 14px; font-weight: 600;">
          Regenerate dashboard
        </h3>
        <p style="margin: 0; color: {$theme.fgDim}; font-size: 12px;">
          Overwrite the backing markdown with the default template. Any custom
          edits will be lost.
        </p>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <button
          data-global-agentic-dashboard-regenerate
          type="button"
          on:click|preventDefault={() => void regenerateDashboard()}
          disabled={regenerating}
          title="Delete and regenerate the Global Agents dashboard from its default template"
          style="
            align-self: flex-start;
            background: transparent; color: {$theme.fgDim};
            border: 1px solid {$theme.border}; border-radius: 3px;
            padding: 4px 12px; font-size: 12px;
            cursor: {regenerating ? 'wait' : 'pointer'};
            opacity: {regenerating ? 0.6 : 1};
          "
        >
          {regenerating ? "Regenerating…" : "Regenerate Dashboard"}
        </button>
        {#if regenerateError}
          <div
            data-global-agentic-dashboard-regenerate-error
            style="color: {$theme.danger}; font-size: 11px;"
          >
            {regenerateError}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>
