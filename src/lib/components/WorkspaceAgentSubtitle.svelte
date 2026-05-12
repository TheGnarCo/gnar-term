<script lang="ts">
  /**
   * WorkspaceAgentSubtitle — per-Workspace agent status, rendered as
   * an inline subtitle row between the workspace title and its CWD.
   *
   * Layout: a flex-column inside the parent SidebarSubtitleRow.
   *   - Header line: agent-count badge + branch-lifecycle pill (when
   *     exactly one workspace branch matches a pane).
   *   - One line per active agent: name + status pill, clickable to
   *     focus the agent's surface.
   *
   * Hides itself entirely when no active agents are present (and no
   * lifecycle pill would render). Registered by core in
   * init-agent-status.ts — not an extension contribution — so the
   * visibility ships with the Workspace itself.
   */
  import { derived, get } from "svelte/store";
  import {
    agentsStore,
    type DetectedAgent,
  } from "../services/agent-detection-service";
  import {
    branchLifecycleStore,
    listBranchDescriptors,
  } from "../services/branch-lifecycle";
  import { focusSurfaceById } from "../services/surface-service";
  import { TERMINAL_AGENT_STATUSES } from "../services/agent-status-service";

  export let workspaceId: string;

  const activeAgents = derived(agentsStore, ($agents) =>
    $agents.filter(
      (a) =>
        a.workspaceId === workspaceId && !TERMINAL_AGENT_STATUSES.has(a.status),
    ),
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

  function handleAgentClick(agent: DetectedAgent) {
    const live = get(agentsStore).find((a) => a.agentId === agent.agentId);
    if (live) focusSurfaceById(live.surfaceId);
  }
</script>

{#if $activeAgents.length > 0 || $lifecycleEntry}
  <div
    class="workspace-agent-subtitle"
    data-workspace-agent-subtitle={workspaceId}
  >
    {#if $activeAgents.length > 0 || $lifecycleEntry}
      <div class="header-row">
        {#if $activeAgents.length > 0}
          <span
            class="agent-count-badge"
            data-agent-count={$activeAgents.length}
          >
            {$activeAgents.length}
            {$activeAgents.length === 1 ? "agent" : "agents"}
          </span>
        {/if}
        {#if $lifecycleEntry}
          <span
            class="lifecycle-pill"
            data-lifecycle={$lifecycleEntry.lifecycle}
          >
            {$lifecycleEntry.lifecycle}
          </span>
        {/if}
      </div>
    {/if}
    {#each $activeAgents as agent (agent.agentId)}
      <button
        type="button"
        class="agent-row"
        data-agent-row={agent.agentId}
        on:click|stopPropagation={() => handleAgentClick(agent)}
      >
        <span class="agent-name">{agent.agentName}</span>
        <span class="status-pill" data-status={agent.status}
          >{agent.status}</span
        >
      </button>
    {/each}
  </div>
{/if}

<style>
  .workspace-agent-subtitle {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
    font-size: 0.75rem;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 4px;
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

  .agent-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .agent-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .agent-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-pill {
    padding: 1px 6px;
    border-radius: 99px;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: color-mix(in srgb, currentColor 15%, transparent);
  }
</style>
