<script lang="ts">
  /**
   * WorkspaceAgentRow — per-agent child row rendered under a Workspace
   * banner. Click focuses the agent's surface.
   *
   * Registered by core in init-agent-status.ts under the "agent-row" kind.
   * Receives `{ id }` (the agent id) and looks up the live agent reactively
   * from agentsStore; renders nothing when the agent has exited.
   */
  import { derived, get } from "svelte/store";
  import { agentsStore } from "../services/agent-detection-service";
  import { focusSurfaceById } from "../services/surface-service";

  export let id: string;

  const agent = derived(
    agentsStore,
    ($agents) => $agents.find((a) => a.agentId === id) ?? null,
  );

  function handleClick() {
    const current = get(agent);
    if (current) focusSurfaceById(current.surfaceId);
  }
</script>

{#if $agent}
  <button
    type="button"
    class="agent-row"
    data-agent-row={id}
    on:click={handleClick}
  >
    <span class="agent-name">{$agent.agentName}</span>
    <span class="status-pill" data-status={$agent.status}>{$agent.status}</span>
  </button>
{/if}

<style>
  .agent-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    font-size: 0.8rem;
    width: 100%;
    background: transparent;
    border: 0;
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
