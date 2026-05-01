<script lang="ts">
  export let size: number = 12;
  export let color: string = "currentColor";
  /** Accessible title — when set, the SVG exposes it as its accessible name. */
  export let title: string | undefined = undefined;
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
  style="flex-shrink: 0;"
  aria-hidden={title ? undefined : "true"}
>
  {#if title}<title>{title}</title>{/if}
  <path d="M12 8V4H8" />
  <rect width="16" height="12" x="4" y="8" rx="2" />
  <path d="M2 14h2" />
  <path d="M20 14h2" />
  <path d="M15 13v2" />
  <path d="M9 13v2" />
</svg>
