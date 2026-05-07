<script lang="ts">
  /**
   * Diff icon — lucide `diff` glyph. A plus symbol (added lines) above
   * a minus bar (removed lines) inside a square — the canonical
   * git-diff iconography used across Lucide, Heroicons, and Primer.
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
  <path d="M12 3v14" />
  <path d="M5 10h14" />
  <path d="M5 21h14" />
</svg>
