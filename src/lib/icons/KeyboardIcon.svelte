<script lang="ts">
  /**
   * Keyboard icon — used as the tile glyph for the Keyboard Shortcuts
   * dashboard. Lucide-style stroke (width=2, round line caps).
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
  aria-hidden="true"
>
  <rect x="2" y="5" width="20" height="14" rx="2" />
  <path d="M6 9h.01" />
  <path d="M10 9h.01" />
  <path d="M14 9h.01" />
  <path d="M18 9h.01" />
  <path d="M6 13h.01" />
  <path d="M10 13h.01" />
  <path d="M14 13h.01" />
  <path d="M18 13h.01" />
  <path d="M7 17h10" />
</svg>
