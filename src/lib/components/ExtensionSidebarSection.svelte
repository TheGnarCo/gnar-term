<script lang="ts">
  import { theme } from "../stores/theme";
  import type { SidebarItem, SidebarSection } from "../stores/extension-sidebar";
  import { pushEvent } from "../services/mcp-event-buffer";

  export let section: SidebarSection;

  let expanded: Record<string, boolean> = {};

  function handleClick(item: SidebarItem) {
    // Toggle expansion for items that have children so the default render
    // behaves like a tree. The extension can still observe the click event
    // and re-render with different children if it wants to.
    if (item.children && item.children.length > 0) {
      expanded[item.id] = !expanded[item.id];
      expanded = { ...expanded };
    }
    pushEvent({
      type: "sidebar.item_clicked",
      side: section.side,
      sectionId: section.sectionId,
      itemId: item.id,
    });
  }

  function flatten(items: SidebarItem[], depth: number): Array<SidebarItem & { depth: number }> {
    const out: Array<SidebarItem & { depth: number }> = [];
    for (const item of items) {
      out.push({ ...item, depth });
      if (item.children && expanded[item.id]) {
        out.push(...flatten(item.children, depth + 1));
      }
    }
    return out;
  }

  $: flatItems = flatten(section.items, 0);
</script>

<div class="extension-section" data-section-id={section.sectionId}>
  <div class="extension-section-header" style="color: {$theme.fgDim};">
    {section.title}
  </div>
  <div class="extension-section-items">
    {#each flatItems as item (item.id)}
      <button
        class="extension-section-item"
        type="button"
        style="
          color: {$theme.fg};
          padding-left: {8 + (item.indent ?? item.depth) * 12}px;
        "
        on:click={() => handleClick(item)}
      >
        {#if item.icon}
          <span class="extension-section-icon" aria-hidden="true">{item.icon}</span>
        {/if}
        <span class="extension-section-label">{item.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .extension-section {
    display: flex;
    flex-direction: column;
    margin-bottom: 8px;
  }
  .extension-section-header {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 6px 8px 4px 8px;
    font-weight: 600;
  }
  .extension-section-items {
    display: flex;
    flex-direction: column;
  }
  .extension-section-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    text-align: left;
    padding: 4px 8px;
    border-radius: 4px;
    margin: 0 4px;
  }
  .extension-section-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .extension-section-icon {
    flex-shrink: 0;
    width: 14px;
    display: inline-flex;
    justify-content: center;
  }
  .extension-section-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
