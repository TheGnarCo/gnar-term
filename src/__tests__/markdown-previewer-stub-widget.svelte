<script lang="ts">
  // Stub component used by markdown-previewer-components.test.ts to
  // verify that the markdown previewer mounts registered Svelte components
  // and forwards the parsed YAML config as props.
  export let label: string = "";
  export let count: number = 0;
</script>

<div data-stub-widget data-label={label} data-count={String(count)}></div>
