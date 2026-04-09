<script lang="ts">
  import { theme } from "../stores/theme";
  import { contextMenu } from "../stores/ui";
  import { setProjectActive, unregisterProject } from "../stores/project";
  import { showConfirmDialog } from "../stores/dialog-service";
  import type { ProjectState } from "../state";
  import type { Workspace } from "../types";
  import {
    getAggregatedHarnessStatus,
    type AggregatedHarnessStatus,
  } from "../types";
  import { agentStatusColor } from "../agent-utils";
  import type { MenuItem } from "../context-menu-types";

  export let project: ProjectState;
  export let openWorkspaces: Workspace[];
  export let onSwitchToWorkspace: (wsId: string) => void;
  export let onNewWorkspace: (projectId: string) => void;
  export let onOpenDashboard: ((projectId: string) => void) | undefined =
    undefined;

  // Currently open workspaces for this project
  $: visibleWorkspaces = openWorkspaces;

  // Aggregate agent status across all workspaces for this project
  $: agentAggs = openWorkspaces
    .map((ws) => getAggregatedHarnessStatus(ws))
    .filter((a): a is AggregatedHarnessStatus => a !== null);
  $: totalAgents = agentAggs.reduce((sum, a) => sum + a.total, 0);
  $: totalRunning = agentAggs.reduce((sum, a) => sum + a.running, 0);
  $: totalWaiting = agentAggs.reduce((sum, a) => sum + a.waiting, 0);
  $: totalIdle = agentAggs.reduce((sum, a) => sum + a.idle, 0);
  $: totalError = agentAggs.reduce((sum, a) => sum + a.error, 0);

  function showContextMenu(e: MouseEvent) {
    e.preventDefault();
    const items: MenuItem[] = [
      {
        label: project.active ? "Set Inactive" : "Set Active",
        action: () => setProjectActive(project.id, !project.active),
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Remove Project",
        danger: true,
        action: async () => {
          const confirmed = await showConfirmDialog(
            `Remove "${project.name}" from GnarTerm? This will not delete any files on disk.`,
            { title: "Remove Project", confirmLabel: "Remove", danger: true },
          );
          if (confirmed) unregisterProject(project.id);
        },
      },
    ];
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }
</script>

<div
  class="project-card"
  role="group"
  aria-label={project.name}
  on:contextmenu={showContextMenu}
  style="
    background: {$theme.bgSurface};
    border: 1px solid {$theme.border};
    border-left: 3px solid {project.color || $theme.accent};
    border-radius: 8px;
    padding: 16px;
    min-width: 220px;
    max-width: 300px;
  "
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; cursor: pointer;"
    on:click={() => onOpenDashboard?.(project.id)}
  >
    <span
      class="project-title"
      style="font-weight: 600; font-size: 14px; color: {$theme.fg};"
      >{project.name}</span
    >
  </div>
  <div
    style="font-size: 11px; color: {$theme.fgDim}80; margin-bottom: {totalAgents >
    0
      ? '6px'
      : '12px'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
  >
    {project.path}
  </div>

  {#if totalAgents > 0}
    <div
      style="font-size: 11px; color: {$theme.fgMuted}; margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;"
    >
      <span>{totalAgents} agent{totalAgents !== 1 ? "s" : ""}:</span>
      {#if totalRunning > 0}
        <span style="color: {agentStatusColor('running', $theme)};"
          >{totalRunning} running</span
        >
      {/if}
      {#if totalWaiting > 0}
        <span style="color: {agentStatusColor('waiting', $theme)};"
          >{totalWaiting} waiting</span
        >
      {/if}
      {#if totalIdle > 0}
        <span style="color: {agentStatusColor('idle', $theme)};"
          >{totalIdle} idle</span
        >
      {/if}
      {#if totalError > 0}
        <span style="color: {agentStatusColor('error', $theme)};"
          >{totalError} error</span
        >
      {/if}
    </div>
  {/if}

  {#if visibleWorkspaces.length > 0}
    <div
      style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;"
    >
      {#each visibleWorkspaces as ws (ws.id)}
        <button
          class="workspace-row"
          style="
            width: 100%; background: none; border: none; text-align: left;
            display: flex; align-items: center; gap: 6px;
            padding: 4px 8px; border-radius: 4px; cursor: pointer;
            color: {$theme.fg};
          "
          on:click={() => onSwitchToWorkspace(ws.id)}
        >
          <span
            style="font-size: 10px; color: {project.color || $theme.accent};"
            >●</span
          >
          <span style="font-size: 12px;">{ws.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
    <button
      class="action-btn"
      style="font-size: 12px; color: {$theme.accent}; cursor: pointer; padding: 4px 0; background: none; border: none;"
      on:click={() => onNewWorkspace(project.id)}
    >
      + New Workspace
    </button>
    <div style="flex: 1;"></div>
    <button
      class="delete-project-btn"
      style="font-size: 11px; color: {$theme.danger}; cursor: pointer; padding: 4px 0; background: none; border: none;"
      on:click={async () => {
        const confirmed = await showConfirmDialog(
          `Remove "${project.name}" from GnarTerm? This will not delete any files on disk.`,
          { title: "Remove Project", confirmLabel: "Remove", danger: true },
        );
        if (confirmed) unregisterProject(project.id);
      }}
    >
      Remove
    </button>
  </div>
</div>

<style>
  .workspace-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .project-title:hover {
    text-decoration: underline;
  }
  .action-btn:hover {
    text-decoration: underline;
  }
  .delete-project-btn:hover {
    text-decoration: underline;
  }
</style>
