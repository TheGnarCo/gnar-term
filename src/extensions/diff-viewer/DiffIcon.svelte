<script lang="ts">
  /**
   * Diff icon — tile glyph for the per-group Diff dashboard.
   * Two offset bars suggest a before/after diff view.
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
  <path d="M12 3v18" />
  <path d="m3 7 3-4 3 4" />
  <path d="M6 3v14" />
  <path d="m21 17-3 4-3-4" />
  <path d="M18 7v14" />
</svg>
