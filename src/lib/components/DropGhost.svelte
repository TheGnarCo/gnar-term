<script lang="ts">
  /**
   * DropGhost — a styled placeholder that marks where a dragged item
   * would land if released.
   *
   * Two modes:
   *   - Default (no label): generic grey scrim with a white outline,
   *     used for workspace drops and any list where the ghost just
   *     represents "a slot will open here."
   *   - Labeled (project drags): accent-colored tile with the source
   *     item's name centered, matching the strong overlay rendered on
   *     non-source siblings so the drop slot reads as the same kind
   *     of colored tile you're dropping next to.
   */
  import type { ThemeDef } from "../theme-data";

  export let theme: ThemeDef;
  export let height: number;
  /** Left/right margin (in px) to match the hosting list's inset. */
  export let inset: number = 8;
  /** Accent color — used as the tile background in label mode. */
  export let accent: string | undefined = undefined;
  /**
   * When set, the ghost renders as a solid accent-colored tile with
   * this label centered (project drag mode). Otherwise the ghost is
   * a generic grey scrim with a white outline (workspace drag mode).
   */
  export let label: string | undefined = undefined;

  $: void theme;
</script>

{#if label}
  <!-- Drop target: visually distinct from the solid sibling tiles —
       translucent fill + prominent dashed border so it reads as
       "the slot where the row will land" rather than a sibling. -->
  <div
    style="
      height: {height}px;
      margin: 0 {inset}px 0 0;
      background: transparent;
      color: {accent ?? '#fff'};
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 600;
      box-sizing: border-box;
      pointer-events: none;
      border: 2px dashed {accent ?? 'rgba(255, 255, 255, 0.85)'};
      border-radius: 0 6px 6px 0;
    "
    aria-hidden="true"
  >
    {label}
  </div>
{:else}
  <div
    style="
      height: {height}px;
      margin: 0 {inset}px 0 0;
      border: 2px dashed rgba(255, 255, 255, 0.85);
      border-radius: 0 6px 6px 0;
      background: rgba(40, 40, 40, 0.6);
      box-sizing: border-box;
      pointer-events: none;
    "
    aria-hidden="true"
  ></div>
{/if}
