<script lang="ts">
  import type { Component } from "svelte";
  import { theme } from "../stores/theme";
  import { hoveredSidebarBlockId } from "../stores/ui";
  import { shortcutHintsActive } from "../stores/shortcut-hints";
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
  // True when this block's rail is in the expanded hover state —
  // banner overlap and frit-dot width both grow with the rail.
  $: expanded = $hoveredSidebarBlockId === section.id || $shortcutHintsActive;
</script>

{#if section.showLabel !== false}
  <!-- Banner overlaps the rail column by its current width (10px rest,
       20px expanded) so the frit zone above paints dark dots over the
       rail's colored dots in the header row. The overlap grows with
       the rail so the banner never loses coverage of the rail when the
       rail expands. -->
  <div
    style="
      position: relative;
      margin-left: {expanded ? '-20px' : '-10px'};
      padding: 6px 12px 6px {expanded ? '20px' : '10px'};
      background: {$shortcutHintsActive
      ? ($theme.fgDim ?? 'rgba(120,120,120,0.9)')
      : `color-mix(in srgb, ${$theme.fgDim} 50%, ${$theme.sidebarBg ?? 'transparent'})`};
      transition: margin-left 0.12s ease-out, padding-left 0.12s ease-out, background 0.12s ease-out;
      pointer-events: none;
    "
  >
    <!-- Dark-dot frit over the rail-overlap zone on the left. Width
         tracks the rail (10px rest, 20px expanded). Dot pattern stays
         identical in both states — only the zone widens on hover. -->
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 0; bottom: 0;
        left: 0; width: {expanded ? '20px' : '10px'};
        pointer-events: none;
        background-image: radial-gradient(circle, #000 0.8px, transparent 1.2px), radial-gradient(circle, #000 0.8px, transparent 1.2px);
        background-size: 5px 5px;
        background-position: 0 0, 2.5px 2.5px;
        background-repeat: repeat;
        transition: width 0.12s ease-out;
      "
    ></div>
    <!-- Title row: 8px left padding creates the same gap other rows use
         between the rail's right edge and their leading content. -->
    {#if section.collapsible !== false}
      <button
        style="
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.5px; text-transform: uppercase;
          color: {$theme.fg};
          cursor: pointer;
          display: flex; align-items: center; gap: 4px;
          padding-left: 8px;
          pointer-events: auto;
          background: none; border: none; font-family: inherit; width: 100%; text-align: left;
        "
        aria-expanded={!collapsed}
        on:click={onToggleCollapse}
      >
        <span
          aria-hidden="true"
          style="font-size: 8px; transform: rotate({collapsed
            ? '-90deg'
            : '0'}); transition: transform 0.15s;">&#9660;</span
        >
        {section.label}
      </button>
    {:else}
      <div
        style="
          font-size: 10px; font-weight: 600;
          letter-spacing: 0.5px; text-transform: uppercase;
          color: {$theme.fg};
          cursor: default;
          display: flex; align-items: center; gap: 4px;
          padding-left: 8px;
          pointer-events: auto;
        "
      >
        {section.label}
      </div>
    {/if}
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
