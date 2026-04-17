<script lang="ts">
  import type { Component } from "svelte";
  import { theme } from "../stores/theme";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";

  export let section: {
    id: string;
    label: string;
    source: string;
    collapsible?: boolean;
    showLabel?: boolean;
    component: Component | unknown;
    props?: Record<string, unknown>;
  };
  export let collapsed: boolean;

  export let onToggleCollapse: () => void;

  $: sectionApi = getExtensionApiById(section.source);
</script>

{#if section.showLabel !== false}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      padding: 6px 12px; font-size: 10px; font-weight: 600;
      letter-spacing: 0.5px; text-transform: uppercase;
      color: {$theme.fgDim};
      border-left: 3px solid {$theme.accent};
      cursor: {section.collapsible !== false ? 'pointer' : 'default'};
      display: flex; align-items: center; gap: 4px;
    "
    on:click={() => {
      if (section.collapsible !== false) onToggleCollapse();
    }}
  >
    {#if section.collapsible !== false}
      <span
        style="font-size: 8px; transform: rotate({collapsed
          ? '-90deg'
          : '0'}); transition: transform 0.15s;">&#9660;</span
      >
    {/if}
    {section.label}
  </div>
{/if}
{#if section.collapsible === false || !collapsed}
  <div>
    {#if sectionApi}
      <ExtensionWrapper
        api={sectionApi}
        component={section.component}
        props={section.props ?? {}}
      />
    {:else if typeof section.component === "function"}
      <svelte:component this={section.component as Component} />
    {/if}
  </div>
{/if}
