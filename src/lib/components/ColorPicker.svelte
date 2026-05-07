<script lang="ts">
  import type { Readable } from "svelte/store";

  /** Theme store — passed by the extension via api.theme */
  export let theme: Readable<Record<string, string>>;

  /** Currently selected color (hex string). Bindable. */
  export let value: string;

  /**
   * Palette of preset swatches. Entries can be hex strings (rendered
   * as-is) or opaque ids (resolved to a hex via `resolveColor`). The
   * picker binds `value` to whichever id the caller provided —
   * callers that want "slot + theme" behavior pass slot names and a
   * resolver; callers that want plain hex pass hex and omit the
   * resolver.
   */
  export let colors: string[] = [];
  /**
   * Map a palette entry (id or hex) to the hex that should actually
   * paint the swatch. Defaults to identity so hex-only callers keep
   * their current behavior.
   */
  export let resolveColor: (entry: string) => string = (c) => c;

  let showCustom = false;
  let customHex = "";

  // Custom-color swatch only lights up when value is a hex the palette
  // doesn't contain — palette entries may be slot names so we compare
  // against the raw entries, not resolved hex.
  $: isCustomColor = value && !colors.includes(value);

  // When switching to a preset, hide the custom input
  function selectPreset(color: string) {
    value = color;
    showCustom = false;
    customHex = "";
  }

  function toggleCustom() {
    showCustom = !showCustom;
    if (showCustom && isCustomColor) {
      customHex = value;
    }
  }

  $: validCustom = /^#[0-9a-fA-F]{6}$/.test(customHex);

  function handleCustomInput() {
    // Auto-prepend # if the user types without it
    if (customHex && !customHex.startsWith("#")) {
      customHex = "#" + customHex;
    }
    if (validCustom) {
      value = customHex;
    }
  }
</script>

<div style="display: flex; flex-direction: column; gap: 8px;">
  <!-- Swatch row -->
  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
    {#each colors as color (color)}
      {@const hex = resolveColor(color)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="
          width: 24px; height: 24px; border-radius: 50%;
          background: {hex}; cursor: pointer;
          border: 2px solid {value === color ? $theme.fg : 'transparent'};
          box-shadow: {value === color ? `0 0 0 1px ${hex}` : 'none'};
          transition: border-color 0.1s, box-shadow 0.1s;
        "
        title={color}
        on:click={() => selectPreset(color)}
      ></div>
    {/each}

    <!-- Custom color button -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        width: 24px; height: 24px; border-radius: 50%;
        background: {isCustomColor ? value : $theme.bgSurface};
        cursor: pointer;
        border: 2px solid {isCustomColor || showCustom
        ? $theme.fg
        : $theme.border};
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; color: {$theme.fgDim};
        transition: border-color 0.1s;
      "
      title="Custom color"
      on:click={toggleCustom}
    >
      {#if isCustomColor}
        <!-- Show nothing — the background IS the preview -->
      {:else}
        <span style="line-height: 1;">+</span>
      {/if}
    </div>
  </div>

  <!-- Custom hex input -->
  {#if showCustom}
    <div style="display: flex; align-items: center; gap: 8px;">
      {#if validCustom}
        <div
          style="
            width: 20px; height: 20px; border-radius: 4px;
            background: {customHex}; flex-shrink: 0;
            border: 1px solid {$theme.border};
          "
        ></div>
      {/if}
      <input
        type="text"
        bind:value={customHex}
        on:input={handleCustomInput}
        placeholder="#ff3366"
        maxlength="7"
        class="no-default-outline"
        style="
          flex: 1; padding: 4px 8px; font-size: 12px;
          font-family: monospace;
          background: {$theme.bgSurface};
          color: {$theme.fg};
          border: 1px solid {validCustom || !customHex
          ? $theme.border
          : $theme.danger};
          border-radius: 4px;
        "
      />
    </div>
  {/if}
</div>
