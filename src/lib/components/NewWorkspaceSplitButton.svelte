<script lang="ts">
  import { theme } from "../stores/theme";
  import { workspaceActionStore } from "../services/workspace-action-registry";
  import { runCommandById } from "../services/command-registry";
  import SidebarActionButton from "./SidebarActionButton.svelte";

  const searchSvg = `<circle cx="7" cy="7" r="4" /><line x1="10" y1="10" x2="13" y2="13" />`;

  $: coreAction = $workspaceActionStore.find(
    (a) => a.id === "core:new-workspace",
  );
</script>

{#if coreAction}
  <span
    class="np-chip"
    style="
      flex-shrink: 0; border-radius: 6px; overflow: hidden;
      background: {$theme.bgHighlight ??
      $theme.bgFloat ??
      'rgba(0, 0, 0, 0.3)'};
      box-shadow: inset 0 0 0 1px {$theme.border ?? 'transparent'};
      --section-btn-fg: {$theme.fg};
      -webkit-app-region: no-drag;
      display: flex; align-items: stretch;
    "
  >
    <button
      style="
        -webkit-app-region: no-drag;
        background: transparent; border: none;
        color: {$theme.fg}; cursor: pointer;
        font-size: 12px; padding: 4px 10px;
        border-right: 1px solid {$theme.border ?? 'rgba(255,255,255,0.12)'};
      "
      on:click={() => coreAction?.handler({})}
    >
      + New
    </button>
    <button
      title="Switch Workspace (⌘O)"
      style="
        -webkit-app-region: no-drag;
        background: transparent; border: none;
        color: {$theme.fgDim}; cursor: pointer;
        padding: 4px 8px;
        display: flex; align-items: center;
      "
      on:click={() => runCommandById("core.workspace-switcher")}
      on:mouseenter={(e) => {
        const el = e.currentTarget;
        if (el instanceof HTMLElement) {
          el.style.background = $theme.bgHighlight;
          el.style.color = $theme.fg;
        }
      }}
      on:mouseleave={(e) => {
        const el = e.currentTarget;
        if (el instanceof HTMLElement) {
          el.style.background = "transparent";
          el.style.color = $theme.fgDim;
        }
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {@html searchSvg}
      </svg>
    </button>
  </span>
{:else}
  <SidebarActionButton
    title="Switch Workspace (⌘O)"
    onClick={() => runCommandById("core.workspace-switcher")}
    theme={$theme}
    svgContent={searchSvg}
  />
{/if}

<style>
  .np-chip button:hover {
    background: rgba(255, 255, 255, 0.08) !important;
  }
</style>
