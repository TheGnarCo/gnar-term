<script lang="ts">
  /**
   * AgentStatusRow — a single composable row for one agent. Renders a
   * status dot, agent name, workspace name, current status, and age.
   * Click → jump-to-pane.
   *
   * Used standalone (rare) and as the building block for AgentList and
   * Kanban cards. When `agent` is passed directly (parent already has
   * the resolved AgentRef), no registry lookup happens; otherwise
   * the row resolves itself from `agentId` against agentsStore.
   */
  import { getContext } from "svelte";
  import {
    EXTENSION_API_KEY,
    type AgentRef,
    type ExtensionAPI,
  } from "../../api";
  import {
    jumpToAgent,
    statusColor,
    timeAgo,
    workspaceNameFor,
  } from "../widget-helpers";

  /** Required when `agent` is not provided. */
  export let agentId: string | undefined = undefined;
  /** Pre-resolved agent — bypasses the registry lookup. */
  export let agent: AgentRef | undefined = undefined;
  /** Compact mode: hide workspace + age — used inside dense kanban cards. */
  export let compact: boolean = false;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const agents = api.agents;

  $: resolved = agent ?? $agents.find((a) => a.agentId === agentId);
  $: dotColor = resolved ? statusColor(resolved.status) : "#888";
  $: wsName = resolved ? workspaceNameFor(api, resolved.workspaceId) : "";
  $: age = resolved ? timeAgo(resolved.lastStatusChange) : "";

  function handleClick() {
    if (resolved) jumpToAgent(api, resolved);
  }
</script>

{#if resolved}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    data-agent-status-row
    data-agent-id={resolved.agentId}
    on:click={handleClick}
    style="
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; cursor: pointer;
      border-radius: 4px;
      background: transparent;
      color: {$theme.fg}; font-size: 12px;
      border: 1px solid {$theme.border};
    "
    on:mouseenter={(e) => {
      const el = e.currentTarget;
      if (el instanceof HTMLElement) el.style.background = $theme.bgHighlight;
    }}
    on:mouseleave={(e) => {
      const el = e.currentTarget;
      if (el instanceof HTMLElement) el.style.background = "transparent";
    }}
    title="Jump to agent"
  >
    <span
      data-status-dot
      style="
        width: 8px; height: 8px; border-radius: 50%;
        background: {dotColor}; flex-shrink: 0;
      "
    ></span>
    <span
      data-agent-name
      style="
        font-weight: 500;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 0 1 auto; min-width: 0;
      "
    >
      {resolved.agentName}
    </span>
    {#if !compact}
      <span
        data-agent-workspace
        style="
          color: {$theme.fgDim}; font-size: 11px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          flex: 0 1 auto; min-width: 0;
        "
      >
        {wsName}
      </span>
    {/if}
    <span
      data-agent-status
      style="
        margin-left: auto; color: {dotColor}; font-size: 11px;
        flex-shrink: 0;
      "
    >
      {resolved.status}
    </span>
    {#if !compact}
      <span
        data-agent-age
        style="color: {$theme.fgDim}; font-size: 11px; flex-shrink: 0;"
      >
        {age}
      </span>
    {/if}
  </div>
{:else}
  <div
    data-agent-status-row-missing
    style="color: {$theme.fgDim}; font-size: 11px; padding: 6px 10px;"
  >
    Agent not found.
  </div>
{/if}
