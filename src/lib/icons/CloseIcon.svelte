<script lang="ts">
  export let width: string = "9";
  export let height: string = "9";
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  {width}
  {height}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2.5"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <title>Close</title>
  <path d="M18 6L6 18M6 6l12 12" />
</svg>

<style>
  svg {
    display: block;
  }
</style>
