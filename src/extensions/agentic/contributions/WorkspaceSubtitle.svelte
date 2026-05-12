<script lang="ts">
  import { getContext } from "svelte";
  import { derived } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";

  const { workspaceId }: { workspaceId: string } = $props();

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);

  /**
   * Count of active (non-terminal) agents for this workspace.
   * Terminal states per agent-state.ts: "errored" | "completed".
   */
  const agentCount = derived(
    api.agents,
    ($agents) =>
      $agents.filter(
        (a) =>
          a.workspaceId === workspaceId &&
          a.status !== "errored" &&
          a.status !== "completed",
      ).length,
  );

  /**
   * Resolve a lifecycle entry for this workspace.
   *
   * Mapping path: workspaceId → agents in that workspace → their paneIds
   * → branches whose paneId matches → branchId → branchLifecycle entry.
   *
   * `listBranches()` is a snapshot call (not a store), so we re-derive
   * inside the derived callback to pick up the current branch list whenever
   * either agents or branchLifecycle changes.
   *
   * If no unambiguous match exists the pill is hidden — never crashes.
   */
  const lifecycleEntry = derived(
    [api.agents, api.branchLifecycle],
    ([$agents, $branchLifecycle]) => {
      // Collect pane IDs from agents in this workspace.
      const paneIds = new Set(
        $agents
          .filter((a) => a.workspaceId === workspaceId && a.paneId !== null)
          .map((a) => a.paneId as string),
      );

      if (paneIds.size === 0) return undefined;

      // Find branches whose active pane is one of those panes.
      const branches = api.listBranches();
      const matchingBranchIds = branches
        .filter((b) => b.paneId !== null && paneIds.has(b.paneId as string))
        .map((b) => b.branchId);

      // Return entry only when exactly one branch matches (avoid ambiguity).
      if (matchingBranchIds.length !== 1) return undefined;

      const branchId = matchingBranchIds[0] as string;
      return $branchLifecycle.get(branchId);
    },
  );
</script>

<span class="workspace-subtitle" data-workspace-subtitle={workspaceId}>
  <span class="agent-count-badge" data-agent-count={$agentCount}>
    {$agentCount}
    {$agentCount === 1 ? "agent" : "agents"}
  </span>
  {#if $lifecycleEntry}
    <span class="lifecycle-pill" data-lifecycle={$lifecycleEntry.lifecycle}>
      {$lifecycleEntry.lifecycle}
    </span>
  {/if}
</span>

<style>
  .workspace-subtitle {
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
