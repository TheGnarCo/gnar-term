<script lang="ts">
  import { getContext, setContext, onMount } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import type { ExtensionSurface } from "../../lib/types";
  import ZonePicker from "./ZonePicker.svelte";

  export let surface: ExtensionSurface;
  export let visible: boolean = true;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  // Re-provide the API context so dynamically mounted components can access it
  setContext(EXTENSION_API_KEY, api);

  interface ZoneConfig {
    zoneId: string;
    contentType: "tab" | "section" | null;
    contentId: string | null;
    component: unknown | null;
    label: string | null;
  }

  const DEFAULT_ZONES: ZoneConfig[] = [
    {
      zoneId: "top-left",
      contentType: null,
      contentId: null,
      component: null,
      label: null,
    },
    {
      zoneId: "top-right",
      contentType: null,
      contentId: null,
      component: null,
      label: null,
    },
    {
      zoneId: "bottom-left",
      contentType: null,
      contentId: null,
      component: null,
      label: null,
    },
    {
      zoneId: "bottom-right",
      contentType: null,
      contentId: null,
      component: null,
      label: null,
    },
  ];

  let zones: ZoneConfig[] = DEFAULT_ZONES.map((z) => ({ ...z }));
  let activePickerZone: string | null = null;

  function stateKey(): string {
    return `dashboard-${surface.id || "default"}`;
  }

  /** Resolve a component from the registries by content type and id. */
  function resolveComponent(
    contentType: "tab" | "section",
    contentId: string,
  ): { component: unknown; label: string } | null {
    if (contentType === "tab") {
      const tab = api.getSidebarTabs().find((t) => t.id === contentId);
      if (tab) return { component: tab.component, label: tab.label };
    } else {
      const section = api.getSidebarSections().find((s) => s.id === contentId);
      if (section)
        return { component: section.component, label: section.label };
    }
    return null;
  }

  /** Load persisted zone config and resolve components. */
  function loadState(): void {
    const persisted = api.state.get<
      Array<{
        zoneId: string;
        contentType: "tab" | "section" | null;
        contentId: string | null;
      }>
    >(stateKey());

    if (!persisted) return;

    for (const saved of persisted) {
      const zone = zones.find((z) => z.zoneId === saved.zoneId);
      if (zone && saved.contentType && saved.contentId) {
        const resolved = resolveComponent(saved.contentType, saved.contentId);
        if (resolved) {
          zone.contentType = saved.contentType;
          zone.contentId = saved.contentId;
          zone.component = resolved.component;
          zone.label = resolved.label;
        }
      }
    }
    zones = zones;
  }

  /** Persist zone config (without component references). */
  function saveState(): void {
    api.state.set(
      stateKey(),
      zones.map((z) => ({
        zoneId: z.zoneId,
        contentType: z.contentType,
        contentId: z.contentId,
      })),
    );
  }

  function handleZoneSelect(
    zoneId: string,
    contentType: "tab" | "section",
    contentId: string,
    component: unknown,
  ): void {
    const zone = zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;

    const label =
      contentType === "tab"
        ? (api.getSidebarTabs().find((t) => t.id === contentId)?.label ??
          contentId)
        : (api.getSidebarSections().find((s) => s.id === contentId)?.label ??
          contentId);

    zone.contentType = contentType;
    zone.contentId = contentId;
    zone.component = component;
    zone.label = label;
    zones = zones;
    activePickerZone = null;
    saveState();
  }

  function clearZone(zoneId: string): void {
    const zone = zones.find((z) => z.zoneId === zoneId);
    if (!zone) return;
    zone.contentType = null;
    zone.contentId = null;
    zone.component = null;
    zone.label = null;
    zones = zones;
    saveState();
  }

  onMount(() => {
    loadState();
  });
</script>

<div
  class="dashboard-grid"
  style="
    background: {$theme.bg};
    color: {$theme.fg};
  "
>
  {#each zones as zone (zone.zoneId)}
    <div
      class="dashboard-zone"
      class:empty={!zone.component}
      style="
        border-color: {zone.component ? $theme.border : 'transparent'};
        {!zone.component
        ? `border: 2px dashed ${$theme.border};`
        : `border: 1px solid ${$theme.border};`}
        background: {$theme.bg};
      "
    >
      {#if zone.component}
        <div
          class="zone-header"
          style="border-bottom: 1px solid {$theme.border};"
        >
          <span class="zone-label" style="color: {$theme.fgDim};">
            {zone.label}
          </span>
          <button
            class="zone-clear"
            style="color: {$theme.fgDim};"
            title="Remove content"
            on:click={() => clearZone(zone.zoneId)}
          >
            x
          </button>
        </div>
        <div class="zone-content">
          <svelte:component this={zone.component} />
        </div>
      {:else}
        <div class="zone-empty-content" style="position: relative;">
          <button
            class="zone-add"
            style="color: {$theme.fgDim}; border-color: {$theme.border};"
            title="Add content"
            on:click={() => (activePickerZone = zone.zoneId)}
          >
            +
          </button>
          {#if activePickerZone === zone.zoneId}
            <ZonePicker
              onSelect={(contentType, contentId, component) =>
                handleZoneSelect(
                  zone.zoneId,
                  contentType,
                  contentId,
                  component,
                )}
              onClose={() => (activePickerZone = null)}
            />
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 8px;
    padding: 8px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }

  .dashboard-zone {
    display: flex;
    flex-direction: column;
    min-height: 200px;
    border-radius: 6px;
    overflow: hidden;
  }

  .dashboard-zone.empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px;
    flex-shrink: 0;
  }

  .zone-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .zone-clear {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: inherit;
  }

  .zone-clear:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .zone-content {
    flex: 1;
    overflow: auto;
  }

  .zone-empty-content {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .zone-add {
    background: none;
    border: 2px dashed;
    border-radius: 8px;
    width: 48px;
    height: 48px;
    font-size: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
    transition: opacity 0.15s;
  }

  .zone-add:hover {
    opacity: 0.7;
  }
</style>
