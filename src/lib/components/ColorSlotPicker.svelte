<script lang="ts">
  /**
   * ColorSlotPicker — a small color-swatch grid for picking one of the
   * named `WORKSPACE_COLOR_SLOTS` tones. Used by settings panels that let
   * the user tint a sidebar row (workspace banner, Global Agentic
   * Dashboard, etc.). The picker is purely presentational; the caller
   * supplies the current selection and handles persistence via `onSelect`.
   */
  import { theme } from "../stores/theme";
  import { WORKSPACE_COLOR_SLOTS, resolveWorkspaceColor } from "../theme-data";

  export let currentSlot: string;
  export let onSelect: (slot: string) => void;

  function handleKeydown(event: KeyboardEvent): void {
    const idx = WORKSPACE_COLOR_SLOTS.indexOf(
      currentSlot as (typeof WORKSPACE_COLOR_SLOTS)[number],
    );
    let nextIdx: number | null = null;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      nextIdx = (idx + 1) % WORKSPACE_COLOR_SLOTS.length;
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      nextIdx =
        (idx - 1 + WORKSPACE_COLOR_SLOTS.length) % WORKSPACE_COLOR_SLOTS.length;
    }
    if (nextIdx !== null) {
      const nextSlot = WORKSPACE_COLOR_SLOTS[nextIdx]!;
      onSelect(nextSlot);
      document
        .querySelector<HTMLElement>(`[data-color-slot="${nextSlot}"]`)
        ?.focus();
    }
  }
</script>

<div
  data-color-picker
  role="radiogroup"
  tabindex="0"
  on:keydown={handleKeydown}
  style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;"
>
  {#each WORKSPACE_COLOR_SLOTS as slot (slot)}
    {@const hex = resolveWorkspaceColor(slot, $theme)}
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
