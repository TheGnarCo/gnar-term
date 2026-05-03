<script lang="ts">
  /**
   * WorkspaceOverviewRow — a single nested workspace row in the global
   * Workspaces dashboard. Subscribes to git-dirty and agent-status stores
   * at the component top level (Svelte requirement for reactive $store).
   */
  import { workspaceDirtyStore } from "../services/workspace-git-dirty-store";
  import { getWorkspaceStatusByCategory } from "../services/status-registry";
  import { aggregateAgentBadges } from "../status-colors";
  import { theme } from "../stores/theme";
  import type { NestedWorkspace } from "../types";

  export let nw: NestedWorkspace;
  export let active: boolean = false;
  export let dirtyPath: string | null = null;
  export let onClick: (id: string) => void;

  // Top-level store subscriptions — Svelte requires these at component level.
  $: dirtyStore = dirtyPath ? workspaceDirtyStore(dirtyPath) : null;
  $: statusStore = getWorkspaceStatusByCategory(nw.id, "process");
  $: badges = aggregateAgentBadges($statusStore);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="button"
  tabindex="0"
  data-workspace-overview-row={nw.id}
  data-active={active ? "true" : undefined}
  on:click={() => onClick(nw.id)}
  on:keydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick(nw.id);
    }
  }}
  style="
    display: flex; align-items: center; gap: 8px;
    padding: 0 20px 0 32px;
    height: 32px;
    cursor: pointer;
    background: {active ? $theme.bgHighlight : 'transparent'};
    border-left: 2px solid {active ? $theme.accent : 'transparent'};
    font-size: 13px;
    color: {active ? $theme.fg : $theme.fgDim};
    user-select: none;
    transition: background 80ms;
  "
>
  <!-- Workspace name -->
  <span
    style="
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: {active ? 600 : 400};
    "
  >
    {nw.name}
  </span>

  <!-- Git dirty indicator -->
  {#if dirtyStore && $dirtyStore?.hasChanges}
    <span
      data-workspace-overview-dirty
      title="Working tree has uncommitted changes"
      style="
        width: 7px; height: 7px; border-radius: 50%;
        background: {$theme.warning};
        flex-shrink: 0;
      "
    ></span>
  {/if}

  <!-- Agent status chips -->
  {#each badges as badge (badge.variant ?? "default")}
    <span
      data-workspace-overview-agent-badge={badge.variant ?? "default"}
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
</div>
