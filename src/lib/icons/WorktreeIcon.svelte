<script lang="ts">
  export let size: number = 12;
  export let color: string = "currentColor";
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke={color}
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <circle cx="4" cy="4" r="2" />
  <circle cx="4" cy="12" r="2" />
  <circle cx="12" cy="8" r="2" />
  <path d="M4 6 L4 10" />
  <path d="M6 4 C8 4 10 6 10 8" />
</svg>
