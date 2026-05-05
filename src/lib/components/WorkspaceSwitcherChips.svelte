<script lang="ts">
  import { workspaceDirtyStore } from "../services/workspace-git-dirty-store";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { aggregateAgentBadges } from "../status-colors";
  import { theme } from "../stores/theme";
  import type { Workspace } from "../types";

  export let ws: Workspace;
  export let dirtyPath: string | null = null;

  $: dirtyStore = dirtyPath ? workspaceDirtyStore(dirtyPath) : null;
  $: statusStore = getWorkspaceStatusByCategory(ws.id, "process");
  $: badges = aggregateAgentBadges($statusStore);
</script>

{#if dirtyStore && $dirtyStore?.hasChanges}
  <span
    data-workspace-switcher-dirty
    title="Working tree has uncommitted changes"
    style="
      width: 7px; height: 7px; border-radius: 50%;
      background: {$theme.warning};
      flex-shrink: 0;
    "
  ></span>
{/if}

{#each badges as badge (badge.variant ?? "default")}
  <span
    data-workspace-switcher-agent-badge={badge.variant ?? "default"}
    title="Agent: {badge.label}"
    style="
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px; font-weight: 600;
      color: {badge.color};
      background: {badge.color}22;
      flex-shrink: 0;
      white-space: nowrap;
    "
  >
    {badge.label}
  </span>
{/each}
