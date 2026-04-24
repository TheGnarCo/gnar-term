<script lang="ts">
  /**
   * Inline bot SVG used as the root-row icon for the Global Agentic
   * Dashboard pseudo-workspace. Simple monochrome outline so it reads
   * well at the 16–20px sidebar size. `currentColor` lets the sidebar's
   * hover / active tints drive the stroke without prop plumbing.
   */
  export let size: number = 16;
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <rect x="4" y="8" width="16" height="12" rx="2" />
  <path d="M12 4v4" />
  <circle cx="12" cy="3" r="1" />
  <circle cx="9" cy="13" r="1" />
  <circle cx="15" cy="13" r="1" />
  <path d="M9 17h6" />
  <path d="M2 14v2" />
  <path d="M22 14v2" />
</svg>
