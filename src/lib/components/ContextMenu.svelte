<script lang="ts">
  import { contextMenu } from "../stores/ui";
  import { theme } from "../stores/theme";

  function close() {
    contextMenu.set(null);
  }

  function handleMousedown(e: MouseEvent) {
    const el = document.getElementById("context-menu");
    if (el && !el.contains(e.target as Node)) close();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  // Keep menu on screen
  function clampPosition(x: number, y: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    el.style.left = `${Math.min(x, maxX)}px`;
    el.style.top = `${Math.min(y, maxY)}px`;
  }

  function positionMenu(el: HTMLElement) {
    if ($contextMenu) {
      clampPosition($contextMenu.x, $contextMenu.y, el);
    }
  }
</script>

<svelte:window on:mousedown={handleMousedown} on:keydown={handleKeydown} />

{#if $contextMenu}
  <div
    id="context-menu"
    use:positionMenu
    style="
      position: fixed; z-index: 9999;
      background: {$theme.bgFloat}; border: 1px solid {$theme.border};
      border-radius: 8px; padding: 4px 0;
      min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      font-size: 13px; color: {$theme.fg};
    "
  >
    {#each $contextMenu.items as item}
      {#if item.separator}
        <div style="height: 1px; background: {$theme.border}; margin: 4px 8px;"></div>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="menu-row"
          class:disabled={item.disabled}
          class:danger={item.danger}
          style="
            padding: 6px 16px; cursor: {item.disabled ? 'default' : 'pointer'};
            display: flex; align-items: center; justify-content: space-between;
            color: {item.disabled ? $theme.fgDim : item.danger ? $theme.danger : $theme.fg};
            opacity: {item.disabled ? '0.5' : '1'};
          "
          on:click|stopPropagation={() => {
            if (!item.disabled) {
              close();
              item.action();
            }
          }}
          on:mouseenter={(e) => {
            if (!item.disabled) {
              const el = e.currentTarget;
              if (el instanceof HTMLElement)
                el.style.background = item.danger ? `color-mix(in srgb, ${$theme.danger} 20%, transparent)` : $theme.bgHighlight;
            }
          }}
          on:mouseleave={(e) => {
            const el = e.currentTarget;
            if (el instanceof HTMLElement) el.style.background = "transparent";
          }}
        >
          <span>{item.label}</span>
          {#if item.shortcut}
            <span style="font-size: 11px; color: {$theme.fgDim}; margin-left: 24px;">{item.shortcut}</span>
          {/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}
