<script lang="ts">
  /**
   * DropGhost — a styled placeholder that marks where a dragged item
   * would land if released.
   *
   * Rail-flush: rounded only on the right (`0 6px 6px 0`) with a
   * right-only inset (`margin: 0 {inset}px 0 0`) so the ghost lines up
   * with the colored rail at the row's left edge. Top/bottom margins are
   * intentionally 0 — the DropGhost renders inside a row container that
   * already supplies the inter-row gap.
   *
   * Two modes:
   *   - Default (no label): grey scrim with a dashed white outline, for
   *     workspace/group drops.
   *   - Labeled: accent-colored dashed tile with the source row's name
   *     centered, for member/anchor drags that want a colored slot.
   */
  export let height: number;
  /** Right inset (in px) to match the hosting list's rail gutter. */
  export let inset: number = 8;
  /** Accent color — used as the border/text in label mode. */
  export let accent: string | undefined = undefined;
  /**
   * When set, the ghost renders the label centered in an accent-colored
   * dashed tile. Otherwise it is a generic grey scrim.
   */
  export let label: string | undefined = undefined;
</script>

{#if label}
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
      border: 1px dashed {accent ?? 'rgba(255, 255, 255, 0.85)'};
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
      border: 1px dashed rgba(255, 255, 255, 0.85);
      border-radius: 0 6px 6px 0;
      background: rgba(40, 40, 40, 0.6);
      box-sizing: border-box;
      pointer-events: none;
    "
    aria-hidden="true"
  ></div>
{/if}
