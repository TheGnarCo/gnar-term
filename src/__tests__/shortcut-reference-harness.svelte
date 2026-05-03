<script lang="ts">
  import ShortcutReference from "../lib/components/ShortcutReference.svelte";

  export let open = true;
</script>

<div data-testid="shortcut-reference-harness">
  open={String(open)}
  <ShortcutReference bind:open />
</div>
