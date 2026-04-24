<script lang="ts">
  export let filterIds: Set<string> = new Set();
  export let accentColor: string = "";
  export let scopeId: string = "";
  export let containerBlockId: string = "";
  export let containerLabel: string = "";
  export let dashboardHintFor: unknown = undefined;
  export let hideStatusBadges: boolean = false;
</script>

<div data-testid="stub-workspace-list" data-count={filterIds.size}></div>
