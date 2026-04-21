<script lang="ts">
  /**
   * ColorSlotPicker — a small color-swatch grid for picking one of the
   * named `PROJECT_COLOR_SLOTS` tones. Used by settings panels that let
   * the user tint a sidebar row (workspace group banner, Global Agentic
   * Dashboard, etc.). The picker is purely presentational; the caller
   * supplies the current selection and handles persistence via `onSelect`.
   */
  import { theme } from "../stores/theme";
  import { PROJECT_COLOR_SLOTS, resolveProjectColor } from "../theme-data";

  export let currentSlot: string;
  export let onSelect: (slot: string) => void;
</script>

<div
  data-color-picker
  role="radiogroup"
  style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;"
>
  {#each PROJECT_COLOR_SLOTS as slot (slot)}
    {@const hex = resolveProjectColor(slot, $theme)}
    {@const isSelected = slot === currentSlot}
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      data-color-slot={slot}
      data-selected={isSelected ? "true" : undefined}
      title={slot}
      on:click={() => onSelect(slot)}
      style="
        width: 32px; height: 32px; border-radius: 6px;
        background: {hex};
        border: 2px solid {isSelected ? $theme.fg : 'transparent'};
        cursor: pointer;
        padding: 0;
      "
      aria-label={`Select ${slot}`}
    ></button>
  {/each}
</div>
