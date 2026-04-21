<script lang="ts">
  /**
   * Grid icon — used as the tile glyph for the core Group Dashboard
   * (the per-group Overview). Stroke-matched to other dashboard icons.
   */
  export let size: number = 14;
  export let color: string = "currentColor";
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect x="3" y="3" width="7" height="9" />
  <rect x="14" y="3" width="7" height="5" />
  <rect x="14" y="12" width="7" height="9" />
  <rect x="3" y="16" width="7" height="5" />
</svg>
