<script lang="ts">
  import { getContext } from "svelte";
  import { derived, get } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";

  const { id }: { id: string } = $props();

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);

  // Look up the agent by id. Null when not found — component renders nothing.
  const agent = derived(
    api.agents,
    ($agents) => $agents.find((a) => a.agentId === id) ?? null,
  );

  function handleClick() {
    const current = get(agent);
    if (current) api.focusSurface(current.surfaceId);
  }
</script>

{#if $agent}
  <button
    type="button"
    class="agent-row-banner"
    data-agent-row={id}
    onclick={handleClick}
  >
    <span class="agent-name">{$agent.agentName}</span>
    <span class="status-pill" data-status={$agent.status}>{$agent.status}</span>
  </button>
{/if}

<style>
  .agent-row-banner {
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

  .agent-row-banner:hover {
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
