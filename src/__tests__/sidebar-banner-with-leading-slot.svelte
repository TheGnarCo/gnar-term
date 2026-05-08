<script>
  import SidebarBanner from "../lib/components/SidebarBanner.svelte";
  export let color = "#4a90d9";
  export let filterIds = new Set();
  export let scopeId = "ws-1";
  export let workspaceListViewComponent;
  export let dashboardCount = 0;
</script>

<SidebarBanner
  {color}
  {filterIds}
  {scopeId}
  {workspaceListViewComponent}
  {dashboardCount}
>
  <svelte:fragment slot="btn-row" let:toggle let:showToggle>
    {#if showToggle}
      <button data-testid="toggle" on:click={toggle}>toggle</button>
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="children-leading">
    <div data-testid="leading">leading-content</div>
  </svelte:fragment>
</SidebarBanner>
