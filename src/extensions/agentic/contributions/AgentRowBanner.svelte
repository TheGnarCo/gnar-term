<script lang="ts">
  import { getContext } from "svelte";
  import { derived } from "svelte/store";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";

  const { id }: { id: string } = $props();

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);

  // Look up the agent by id. Null when not found — component renders nothing.
  const agent = derived(
    api.agents,
    ($agents) => $agents.find((a) => a.agentId === id) ?? null,
  );
</script>

{#if $agent}
  <div class="agent-row-banner" data-agent-row={id}>
    <span class="agent-name">{$agent.agentName}</span>
    <span class="status-pill" data-status={$agent.status}>{$agent.status}</span>
  </div>
{/if}

<style>
  .agent-row-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    font-size: 0.8rem;
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
