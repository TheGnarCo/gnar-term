<script lang="ts">
  import { onDestroy } from "svelte";
  import { agentsStore } from "../services/agent-detection-service";
  import { nestedWorkspaces } from "../stores/nested-workspace";
  import { workspacesStore } from "../stores/workspaces";
  import { switchNestedWorkspace } from "../services/nested-workspace-service";
  import { theme } from "../stores/theme";
  import { buildAgentRows } from "../services/agents-sidebar";
  import type { AgentRow } from "../services/agents-sidebar";

  // --- Elapsed time ---

  let now = Date.now();
  const interval = setInterval(() => {
    now = Date.now();
  }, 30_000);
  onDestroy(() => clearInterval(interval));

  function formatElapsed(createdAt: string): string {
    const ms = now - new Date(createdAt).getTime();
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours >= 1) {
      const remainingMinutes = totalMinutes % 60;
      return remainingMinutes > 0
        ? `${totalHours}h ${remainingMinutes}m`
        : `${totalHours}h`;
    }
    if (totalMinutes >= 1) return `${totalMinutes}m`;
    return `${totalSeconds}s`;
  }

  // --- Status chip colors ---

  function statusColor(status: string): string {
    switch (status) {
      case "running":
      case "active":
        return $theme.success;
      case "waiting":
        return $theme.warning;
      default:
        return $theme.fgDim;
    }
  }

  // --- Derived rows ---

  $: rows = buildAgentRows($agentsStore, $nestedWorkspaces, $workspacesStore);

  // --- Click handler ---

  function handleRowClick(row: AgentRow): void {
    if (row.wsIdx >= 0) {
      switchNestedWorkspace(row.wsIdx);
    }
  }
</script>

<div class="agents-tab" style="flex: 1; overflow-y: auto; font-size: 12px;">
  {#if rows.length === 0}
    <div style="color: {$theme.fgDim}; padding: 16px 12px; font-style: italic;">
      No active agents
    </div>
  {:else}
    {#each rows as row (row.agentId)}
      <button
        class="agent-row"
        style="
          width: 100%; background: none; border: none; border-bottom: 1px solid {$theme.border};
          padding: 8px 12px; cursor: {row.wsIdx >= 0 ? 'pointer' : 'default'};
          display: flex; flex-direction: column; gap: 4px; text-align: left;
        "
        on:click={() => handleRowClick(row)}
      >
        <!-- Top line: status chip + agent name -->
        <div
          style="display: flex; align-items: center; gap: 6px; overflow: hidden;"
        >
          <span
            style="
              background: {statusColor(row.status)}22;
              color: {statusColor(row.status)};
              border: 1px solid {statusColor(row.status)}66;
              border-radius: 3px;
              padding: 0 5px;
              font-size: 10px;
              line-height: 16px;
              white-space: nowrap;
              flex-shrink: 0;
            ">{row.status}</span
          >
          <span
            style="
              color: {$theme.fg};
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              font-weight: 500;
            ">{row.agentName}</span
          >
        </div>
        <!-- Bottom line: project / branch + elapsed -->
        <div
          style="display: flex; align-items: center; justify-content: space-between; gap: 4px; overflow: hidden;"
        >
          <span
            style="
              color: {$theme.fgDim};
              font-size: 11px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            ">{row.projectName} / {row.ctxName}</span
          >
          <span
            style="
              color: {$theme.fgDim};
              font-size: 10px;
              white-space: nowrap;
              flex-shrink: 0;
            ">{formatElapsed(row.createdAt)}</span
          >
        </div>
      </button>
    {/each}
  {/if}
</div>

<style>
  .agent-row:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
</style>
