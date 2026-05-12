<script lang="ts">
  /**
   * WorkspaceAgentSubtitle — agent count badge + branch-lifecycle pill,
   * rendered under every Workspace banner in the primary sidebar.
   *
   * Registered by core in init-agent-status.ts (not an extension contribution)
   * so per-Workspace agentic visibility ships with the Workspace itself.
   *
   * Lifecycle resolution: Workspace → agents in workspace → their paneIds
   * → branches whose paneId matches → branchId → lifecycle entry.
   * The pill is hidden when the chain is ambiguous (≠1 matching branch).
   */
  import { derived } from "svelte/store";
  import { agentsStore } from "../services/agent-detection-service";
  import {
    branchLifecycleStore,
    listBranchDescriptors,
  } from "../services/branch-lifecycle";
  import { TERMINAL_AGENT_STATUSES } from "../services/agent-status-service";

  export let workspaceId: string;

  const agentCount = derived(
    agentsStore,
    ($agents) =>
      $agents.filter(
        (a) =>
          a.workspaceId === workspaceId &&
          !TERMINAL_AGENT_STATUSES.has(a.status),
      ).length,
  );

  const lifecycleEntry = derived(
    [agentsStore, branchLifecycleStore],
    ([$agents, $branchLifecycle]) => {
      const paneIds = new Set(
        $agents
          .filter((a) => a.workspaceId === workspaceId && a.paneId !== null)
          .map((a) => a.paneId as string),
      );
      if (paneIds.size === 0) return undefined;

      const matchingBranchIds = listBranchDescriptors()
        .filter((b) => b.paneId !== null && paneIds.has(b.paneId as string))
        .map((b) => b.branchId);

      if (matchingBranchIds.length !== 1) return undefined;
      return $branchLifecycle.get(matchingBranchIds[0]!);
    },
  );
</script>

{#if $agentCount > 0 || $lifecycleEntry}
  <span
    class="workspace-agent-subtitle"
    data-workspace-agent-subtitle={workspaceId}
  >
    {#if $agentCount > 0}
      <span class="agent-count-badge" data-agent-count={$agentCount}>
        {$agentCount}
        {$agentCount === 1 ? "agent" : "agents"}
      </span>
    {/if}
    {#if $lifecycleEntry}
      <span class="lifecycle-pill" data-lifecycle={$lifecycleEntry.lifecycle}>
        {$lifecycleEntry.lifecycle}
      </span>
    {/if}
  </span>
{/if}

<style>
  .workspace-agent-subtitle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    opacity: 0.8;
  }

  .agent-count-badge {
    font-variant-numeric: tabular-nums;
  }

  .lifecycle-pill {
    padding: 1px 5px;
    border-radius: 99px;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: color-mix(in srgb, currentColor 15%, transparent);
  }
</style>
