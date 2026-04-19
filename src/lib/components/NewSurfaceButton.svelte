<script lang="ts">
  import { theme } from "../stores/theme";
  import { surfaceTypeStore } from "../services/surface-type-registry";
  import { modLabel } from "../terminal-service";

  export let onNewSurface: () => void;
  export let onSelectSurfaceType: (typeId: string) => void;

  // Filter out surface types the contributing extension marked as
  // hideFromNewSurface — e.g. types that need external context (a file
  // path, a commit) and can't be opened from an empty click.
  $: visibleSurfaceTypes = $surfaceTypeStore.filter(
    (s) => !s.hideFromNewSurface,
  );

  $: hasExtra = visibleSurfaceTypes.length > 0;

  let dropdownOpen = false;
  let containerEl: HTMLDivElement;
  let plusHovered = false;
  let chevronHovered = false;

  let chevronEl: HTMLSpanElement;
  let dropdownX = 0;
  let dropdownY = 0;

  function toggleDropdown() {
    if (!dropdownOpen && chevronEl) {
      const rect = chevronEl.getBoundingClientRect();
      dropdownX = rect.left;
      dropdownY = rect.bottom + 2;
    }
    dropdownOpen = !dropdownOpen;
  }

  function handleItemClick(typeId: string) {
    dropdownOpen = false;
    onSelectSurfaceType(typeId);
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
  style="display: inline-flex; align-items: center; position: relative;"
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    title="New terminal ({modLabel}T)"
    style="
      color: {plusHovered ? $theme.fg : $theme.fgDim};
      cursor: pointer; font-size: 14px;
      padding: 2px {hasExtra ? '3px' : '6px'};
      border-bottom: 2px solid {plusHovered ? $theme.accent : 'transparent'};
      transition: color 0.1s, border-color 0.1s;
    "
    on:click={onNewSurface}
    on:mouseenter={() => (plusHovered = true)}
    on:mouseleave={() => (plusHovered = false)}>+</span
  >

  {#if hasExtra}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      bind:this={chevronEl}
      title="New surface type..."
      style="
        color: {chevronHovered || dropdownOpen ? $theme.fg : $theme.fgDim};
        cursor: pointer; font-size: 16px;
        padding: 2px 4px 2px 1px; line-height: 1;
        border-bottom: 2px solid {chevronHovered || dropdownOpen
        ? $theme.accent
        : 'transparent'};
        transition: color 0.1s, border-color 0.1s;
      "
      on:click={toggleDropdown}
      on:mouseenter={() => (chevronHovered = true)}
      on:mouseleave={() => (chevronHovered = false)}>&#9662;</span
    >

    {#if dropdownOpen}
      <div
        style="
          position: fixed; top: {dropdownY}px; left: {dropdownX}px;
          background: {$theme.bgFloat}; border: 1px solid {$theme.border};
          border-radius: 6px; padding: 4px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          z-index: 9999; min-width: 160px;
        "
      >
        <!-- Terminal -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          style="padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; color: {$theme.fg};"
          on:click={() => {
            dropdownOpen = false;
            onNewSurface();
          }}
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
          Terminal
        </div>

        {#if visibleSurfaceTypes.length > 0}
          <div
            style="height: 1px; background: {$theme.border}; margin: 4px 8px;"
          ></div>
          {#each visibleSurfaceTypes as surfaceType (surfaceType.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              style="padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; color: {$theme.fg};"
              on:click={() => handleItemClick(surfaceType.id)}
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
              {surfaceType.label}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>
