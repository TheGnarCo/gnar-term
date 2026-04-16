<script context="module" lang="ts">
  export interface SplitButtonItem {
    id: string;
    label: string;
    icon?: string;
    handler: () => void;
  }
</script>

<script lang="ts">
  import type { Readable } from "svelte/store";

  export let label: string;
  export let onMainClick: () => void;
  export let dropdownItems: SplitButtonItem[] = [];
  export let theme: Readable<Record<string, string>>;
  export let fullWidth: boolean = false;

  // SVG icon fragments for dropdown items (16x16 viewBox)
  const iconSvgMap: Record<string, string> = {
    plus: `<line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />`,
    "git-branch": `<line x1="7" y1="2" x2="7" y2="10" /><line x1="3" y1="6" x2="11" y2="6" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /><path d="M7 10 C7 12 10 12 12 12" fill="none" />`,
    "folder-plus": `<line x1="7" y1="3" x2="7" y2="11" /><line x1="3" y1="7" x2="11" y2="7" /><path d="M10 2 L12 2 L13 3 L15 3 L15 5 L10 5 Z" fill="currentColor" opacity="0.6" />`,
    reorder: `<polyline points="5,1 5,15" /><polyline points="3,3 5,1 7,3" /><polyline points="11,1 11,15" /><polyline points="9,13 11,15 13,13" />`,
  };

  let dropdownOpen = false;
  let containerEl: HTMLDivElement;

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
  }

  function handleItemClick(item: SplitButtonItem) {
    dropdownOpen = false;
    item.handler();
  }

  function handleWindowClick(e: MouseEvent) {
    if (
      dropdownOpen &&
      containerEl &&
      !containerEl.contains(e.target as Node)
    ) {
      dropdownOpen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && dropdownOpen) {
      dropdownOpen = false;
    }
  }
</script>

<svelte:window on:mousedown={handleWindowClick} on:keydown={handleKeydown} />

<div
  bind:this={containerEl}
  style="display: {fullWidth
    ? 'flex'
    : 'inline-flex'}; align-items: stretch; position: relative; -webkit-app-region: no-drag;"
>
  <!-- Main button -->
  <button
    on:click={onMainClick}
    style="
      background: transparent;
      color: {$theme.fgDim};
      border: 1px solid {$theme.border};
      {dropdownItems.length > 0
      ? 'border-right: none; border-radius: 4px 0 0 4px;'
      : 'border-radius: 4px;'}
      padding: 3px 8px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
      {fullWidth ? 'flex: 1;' : ''}
      -webkit-app-region: no-drag;
    "
    on:mouseenter={(e) => {
      const el = e.currentTarget;
      if (el instanceof HTMLElement)
        el.style.background = $theme.bgHighlight ?? "";
    }}
    on:mouseleave={(e) => {
      const el = e.currentTarget;
      if (el instanceof HTMLElement) el.style.background = "transparent";
    }}
  >
    {label}
  </button>

  <!-- Dropdown caret (only if there are items) -->
  {#if dropdownItems.length > 0}
    <button
      title="More actions"
      on:click={toggleDropdown}
      style="
        background: {dropdownOpen ? $theme.bgHighlight : 'transparent'};
        color: {$theme.fgDim};
        border: 1px solid {$theme.border};
        border-radius: 0 4px 4px 0;
        padding: 3px 5px;
        cursor: pointer;
        display: flex;
        align-items: center;
        -webkit-app-region: no-drag;
      "
      on:mouseenter={(e) => {
        const el = e.currentTarget;
        if (el instanceof HTMLElement && !dropdownOpen)
          el.style.background = $theme.bgHighlight ?? "";
      }}
      on:mouseleave={(e) => {
        const el = e.currentTarget;
        if (el instanceof HTMLElement && !dropdownOpen)
          el.style.background = "transparent";
      }}
    >
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
        <path
          d="M1 3 L5 7 L9 3"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- Dropdown menu -->
    {#if dropdownOpen}
      <div
        style="
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 2px;
          background: {$theme.bgFloat};
          border: 1px solid {$theme.border};
          border-radius: 6px;
          padding: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          z-index: 9999;
          min-width: 180px;
        "
      >
        {#each dropdownItems as item (item.id)}
          {#if item.id === "__separator__"}
            <div
              style="height: 1px; background: {$theme.border}; margin: 4px 8px;"
            ></div>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              style="
                padding: 5px 10px;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: {$theme.fg};
              "
              on:click={() => handleItemClick(item)}
              on:mouseenter={(e) => {
                const el = e.currentTarget;
                if (el instanceof HTMLElement)
                  el.style.background = $theme.bgHighlight ?? "";
              }}
              on:mouseleave={(e) => {
                const el = e.currentTarget;
                if (el instanceof HTMLElement)
                  el.style.background = "transparent";
              }}
            >
              {#if item.icon && iconSvgMap[item.icon]}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  style="flex-shrink: 0; color: {$theme.fgDim};"
                >
                  {@html iconSvgMap[item.icon]}
                </svg>
              {/if}
              <span>{item.label}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</div>
