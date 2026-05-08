<script>
  import SidebarBanner from "../lib/components/SidebarBanner.svelte";
  export let color;
  export let filterIds;
  export let scopeId;
  export let workspaceListViewComponent;
</script>

<SidebarBanner {color} {filterIds} {scopeId} {workspaceListViewComponent}>
  <svelte:fragment slot="btn-row" let:toggle>
    <button on:click={toggle}>toggle</button>
  </svelte:fragment>
</SidebarBanner>
