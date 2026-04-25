<script lang="ts">
  export let filterIds: Set<string> = new Set();
  export const accentColor: string = "";
  export const scopeId: string = "";
  export const containerBlockId: string = "";
  export const containerLabel: string = "";
  export const dashboardHintFor: unknown = undefined;
  export const hideStatusBadges: boolean = false;
</script>

<div data-testid="stub-workspace-list" data-count={filterIds.size}></div>
