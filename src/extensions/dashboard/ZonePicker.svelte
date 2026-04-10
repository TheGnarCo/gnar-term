<script lang="ts">
  import { getContext, onMount } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";

  export let onSelect: (
    contentType: "tab" | "section",
    contentId: string,
    component: unknown,
  ) => void;
  export let onClose: () => void;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  $: tabs = api.getSidebarTabs();
  $: sections = api.getSidebarSections();

  let pickerEl: HTMLDivElement;

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    if (pickerEl && !pickerEl.contains(e.target as Node)) {
      onClose();
    }
  }

  onMount(() => {
    // Defer listener to avoid closing immediately from the click that opened us
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="zone-picker"
  bind:this={pickerEl}
  style="
    background: {$theme.bg};
    border: 1px solid {$theme.border};
    color: {$theme.fg};
  "
>
  {#if tabs.length > 0}
    <div class="zone-picker-header" style="color: {$theme.fgDim};">
      Sidebar Tabs
    </div>
    {#each tabs as tab (tab.id)}
      <button
        class="zone-picker-item"
        style="color: {$theme.fg};"
        on:click={() => onSelect("tab", tab.id, tab.component)}
      >
        {tab.label}
      </button>
    {/each}
  {/if}

  {#if sections.length > 0}
    <div class="zone-picker-header" style="color: {$theme.fgDim};">
      Sidebar Sections
    </div>
    {#each sections as section (section.id)}
      <button
        class="zone-picker-item"
        style="color: {$theme.fg};"
        on:click={() => onSelect("section", section.id, section.component)}
      >
        {section.label}
      </button>
    {/each}
  {/if}

  {#if tabs.length === 0 && sections.length === 0}
    <div class="zone-picker-empty" style="color: {$theme.fgDim};">
      No content available
    </div>
  {/if}
</div>

<style>
  .zone-picker {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    min-width: 180px;
    max-height: 300px;
    overflow-y: auto;
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 10;
  }

  .zone-picker-header {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px 4px;
  }

  .zone-picker-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }

  .zone-picker-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .zone-picker-empty {
    padding: 12px;
    font-size: 12px;
    text-align: center;
  }
</style>
