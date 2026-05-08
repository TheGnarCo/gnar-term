<script lang="ts">
  /**
   * Body for the Global Agentic Dashboard pseudo-workspace.
   *
   * Renders a two-tab layout:
   *   - Overview — Kanban + AgentList composed directly. The host metadata
   *     (`isGlobalAgenticDashboard: true`) projected via DashboardHostContext
   *     resolves global scope for embedded widgets without a markdown
   *     intermediary.
   *   - Settings — color picker for the sidebar row.
   */
  import { setDashboardHost } from "../../../lib/contexts/dashboard-host";
  import { getConfig, saveConfig, configStore } from "../../../lib/config";
  import { theme } from "../../../lib/stores/theme";
  import {
    WORKSPACE_COLOR_SLOTS,
    resolveWorkspaceColor,
    type WorkspaceColorSlot,
  } from "../../../lib/theme-data";
  import Kanban from "./Kanban.svelte";
  import AgentList from "./AgentList.svelte";

  const PSEUDO_ID = "agentic.global";
  const hostMetadata = { isGlobalAgenticDashboard: true };

  setDashboardHost({ metadata: hostMetadata });

  let activeTab: "overview" | "settings" = "overview";

  $: currentColorSlot =
    $configStore.pseudoWorkspaceColors?.[PSEUDO_ID] ?? "purple";

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
    const slots = WORKSPACE_COLOR_SLOTS;
    const idx = slots.indexOf(currentColorSlot as WorkspaceColorSlot);
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

  {#if activeTab === "overview"}
    <div
      role="tabpanel"
      id="global-agentic-dashboard-panel-overview"
      aria-labelledby="global-agentic-dashboard-tab-overview"
      data-global-agentic-dashboard-overview
      style="
        flex: 1; min-width: 0; min-height: 0; overflow: auto;
        padding: 24px 32px;
        display: flex; flex-direction: column; gap: 20px;
      "
    >
      <Kanban />
      <AgentList title="Active Agents" />
    </div>
  {/if}

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
          {#each WORKSPACE_COLOR_SLOTS as slot (slot)}
            {@const hex = resolveWorkspaceColor(slot, $theme)}
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
    </div>
  {/if}
</div>
