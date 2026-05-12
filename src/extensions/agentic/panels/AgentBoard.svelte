<script lang="ts">
  // AgentBoard — groups active agents by workspaceId; click a card to focus its surface.
  // API is provided via Svelte context (EXTENSION_API_KEY), set by ExtensionWrapper.
  import { getContext } from "svelte";
  import { derived } from "svelte/store";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type AgentRef,
  } from "../../api";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const agents = api.agents;

  // Group agents by workspaceId, preserving insertion order within each group.
  const grouped = derived(agents, ($agents) => {
    const map = new Map<string, AgentRef[]>();
    for (const agent of $agents) {
      const existing = map.get(agent.workspaceId) ?? [];
      map.set(agent.workspaceId, [...existing, agent]);
    }
    return map;
  });

  function handleFocus(surfaceId: string) {
    // focusSurface is documented as a no-op if the surfaceId is not found (api.ts:707).
    api.focusSurface(surfaceId);
  }

  function statusClass(status: string): string {
    switch (status) {
      case "running":
        return "status-running";
      case "awaiting_input":
        return "status-awaiting";
      case "errored":
        return "status-errored";
      case "completed":
        return "status-completed";
      default:
        return "status-idle";
    }
  }
</script>

{#if $agents.length === 0}
  <p class="empty-state">No agents detected yet.</p>
{:else}
  {#each [...$grouped.entries()] as [workspaceId, workspaceAgents]}
    <div class="workspace-group" data-workspace-group={workspaceId}>
      <h3 class="workspace-label">Workspace {workspaceId}</h3>
      <div class="agent-cards">
        {#each workspaceAgents as agent (agent.agentId)}
          <!-- svelte-ignore a11y_interactive_supports_focus -->
          <div
            class="agent-card"
            data-agent-card={agent.agentId}
            role="button"
            tabindex="0"
            onclick={() => handleFocus(agent.surfaceId)}
            onkeydown={(e) => e.key === "Enter" && handleFocus(agent.surfaceId)}
          >
            <span class="agent-name">{agent.agentName}</span>
            <span class="status-pill {statusClass(agent.status)}"
              >{agent.status}</span
            >
          </div>
        {/each}
      </div>
    </div>
  {/each}
{/if}

<style>
  .empty-state {
    font-size: 0.75rem;
    opacity: 0.4;
    margin: 0;
  }

  .workspace-group {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-bottom: 0.75rem;
  }

  .workspace-label {
    font-size: 0.7rem;
    font-weight: 600;
    opacity: 0.5;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .agent-cards {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .agent-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 0.6rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
    gap: 0.5rem;
  }

  .agent-card:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .agent-name {
    font-size: 0.8rem;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .status-pill {
    font-size: 0.65rem;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    text-transform: lowercase;
    flex-shrink: 0;
  }

  .status-running {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
  }
  .status-awaiting {
    background: rgba(234, 179, 8, 0.2);
    color: #facc15;
  }
  .status-errored {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }
  .status-completed {
    background: rgba(99, 102, 241, 0.2);
    color: #a5b4fc;
  }
  .status-idle {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.5);
  }
</style>
