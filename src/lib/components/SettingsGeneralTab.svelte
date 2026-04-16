<script lang="ts">
  import { theme, themes } from "../stores/theme";

  export let currentTheme: string;
  export let fontSize: number;
  export let fontFamily: string;
  export let opacity: number;
  export let availableFonts: string[];
  export let fontLoadError: string;

  export let onThemeChange: (value: string) => void;
  export let onFontSizeChange: (value: number) => void;
  export let onFontFamilyChange: (value: string) => void;
  export let onOpacityChange: (value: number) => void;
</script>

<div data-page="general">
  <h3 style="margin: 0 0 16px; font-size: 14px; color: {$theme.fg};">
    General
  </h3>

  <div style="display: flex; flex-direction: column; gap: 14px;">
    <!-- Theme -->
    <label style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 11px; color: {$theme.fgDim}; font-weight: 500;"
        >Theme</span
      >
      <select
        data-field="theme"
        value={currentTheme}
        on:change={(e) => onThemeChange(e.currentTarget.value)}
        style="
        padding: 6px 8px; border-radius: 6px;
        background: {$theme.bgSurface}; color: {$theme.fg};
        border: 1px solid {$theme.border}; font-size: 12px;
      "
      >
        {#each Object.entries(themes) as [id, t]}
          <option value={id}>{t.name}</option>
        {/each}
      </select>
    </label>

    <!-- Font Size -->
    <label style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 11px; color: {$theme.fgDim}; font-weight: 500;"
        >Font Size</span
      >
      <input
        data-field="fontSize"
        type="number"
        min="8"
        max="32"
        value={fontSize}
        on:change={(e) => {
          const val = parseInt(e.currentTarget.value);
          if (!isNaN(val) && val > 0) onFontSizeChange(val);
        }}
        style="
        padding: 6px 8px; border-radius: 6px; width: 80px;
        background: {$theme.bgSurface}; color: {$theme.fg};
        border: 1px solid {$theme.border}; font-size: 12px;
      "
      />
    </label>

    <!-- Font Family -->
    <label style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 11px; color: {$theme.fgDim}; font-weight: 500;"
        >Font Family</span
      >
      <select
        data-field="fontFamily"
        value={fontFamily}
        on:change={(e) => onFontFamilyChange(e.currentTarget.value)}
        style="
        padding: 6px 8px; border-radius: 6px; width: 220px;
        background: {$theme.bgSurface}; color: {$theme.fg};
        border: 1px solid {$theme.border}; font-size: 12px;
        cursor: pointer;
      "
      >
        <option value="">Default (auto-detect)</option>
        {#each availableFonts as font}
          <option value={font}>{font}</option>
        {/each}
      </select>
      {#if fontLoadError}
        <span style="font-size: 11px; color: {$theme.danger};"
          >{fontLoadError}</span
        >
      {/if}
    </label>

    <!-- Opacity -->
    <label style="display: flex; flex-direction: column; gap: 4px;">
      <span style="font-size: 11px; color: {$theme.fgDim}; font-weight: 500;"
        >Opacity ({Math.round(opacity * 100)}%)</span
      >
      <input
        data-field="opacity"
        type="range"
        min="0.3"
        max="1"
        step="0.05"
        value={opacity}
        on:input={(e) => onOpacityChange(parseFloat(e.currentTarget.value))}
        style="width: 200px;"
      />
    </label>
  </div>
</div>
