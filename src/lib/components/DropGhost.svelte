<script lang="ts">
  /**
   * DropGhost — a styled placeholder that marks where a dragged item
   * would land if released: a generic grey scrim with a dashed outline,
   * sized to the source row's height so the drop slot matches the drop
   * result.
   */
  export let height: number;
  /** Left/right margin (in px) to match the hosting list's inset. */
  export let inset: number = 8;
</script>

<div
  style="
    height: {height}px;
    margin: 2px {inset}px;
    border: 1px dashed rgba(255, 255, 255, 0.85);
    border-radius: 6px;
    background: rgba(40, 40, 40, 0.6);
    box-sizing: border-box;
    pointer-events: none;
  "
  aria-hidden="true"
></div>
