<script lang="ts">
  /**
   * AgentList — flat list of agents in scope. When `dashboardId` is
   * provided, scopes to that dashboard's baseDir. When omitted, lists
   * every detected agent (used by P11's secondary sidebar tab).
   *
   * Each row delegates to AgentStatusRow so the visual contract stays
   * consistent across composers (Kanban cards reuse the same row).
   */
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../../api";
  import AgentStatusRow from "./AgentStatusRow.svelte";
  import { scopedAgentsStore } from "../widget-helpers";

  /** Optional dashboard scope. */
  export let dashboardId: string | undefined = undefined;
  /** Optional override of the section title. */
  export let title: string = "Active Agents";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  $: agents = scopedAgentsStore(api, dashboardId);
</script>

<div
  data-agent-list
  data-dashboard-id={dashboardId ?? ""}
  style="
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px; border: 1px solid {$theme.border};
    border-radius: 6px; background: {$theme.bgSurface};
  "
>
  <div
    data-agent-list-header
    style="
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: {$theme.fgDim};
      display: flex; align-items: center; gap: 8px;
    "
  >
    <span>{title}</span>
    <span style="margin-left: auto;">{$agents.length}</span>
  </div>

  {#if $agents.length === 0}
    <div
      data-agent-list-empty
      style="color: {$theme.fgDim}; font-style: italic; font-size: 12px; padding: 6px 0;"
    >
      No agents in scope.
    </div>
  {:else}
    {#each $agents as a (a.agentId)}
      <AgentStatusRow agent={a} />
    {/each}
  {/if}
</div>
