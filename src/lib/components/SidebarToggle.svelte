<script lang="ts">
  import { theme } from "../stores/theme";
  import { sidebarVisible } from "../stores/ui";

  let hovered = false;
</script>

{#if !$sidebarVisible}
  <button
    id="sidebar-toggle"
    title="Show Sidebar (⌘B)"
    style="
      background: {hovered ? $theme.bgHighlight : 'none'};
      border: none; border-right: 1px solid {$theme.border};
      color: {hovered ? $theme.fg : $theme.fgDim};
      cursor: pointer; width: 36px;
      display: flex; align-items: center; justify-content: center;
      padding: 38px 0 0 0; flex-shrink: 0; align-self: stretch;
    "
    on:click={() => sidebarVisible.set(true)}
    on:mouseenter={() => hovered = true}
    on:mouseleave={() => hovered = false}
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="1" y="2" width="14" height="12" rx="1.5"/>
      <line x1="5.5" y1="2" x2="5.5" y2="14"/>
    </svg>
  </button>
{/if}
