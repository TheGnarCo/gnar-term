<script>
  import ContainerRow from "../lib/components/ContainerRow.svelte";
  export let color;
  export let filterIds;
  export let scopeId;
  export let workspaceListViewComponent;
</script>

<ContainerRow {color} {filterIds} {scopeId} {workspaceListViewComponent}>
  <svelte:fragment slot="btn-row" let:toggle>
    <button on:click={toggle}>toggle</button>
  </svelte:fragment>
</ContainerRow>
