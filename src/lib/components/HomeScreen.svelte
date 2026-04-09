<script lang="ts">
  import { theme } from "../stores/theme";
  import { activeProjects, projects } from "../stores/project";
  import { workspaces, floatingWorkspaces } from "../stores/workspace";
  import ProjectCard from "./ProjectCard.svelte";
  import type { Workspace } from "../types";
  import {
    getAgentsFromWorkspaces,
    agentStatusColor,
    agentStatusLabel,
    type AgentInfo,
  } from "../agent-utils";

  import { goToProject } from "../stores/ui";

  export let onSwitchToWorkspace: (wsId: string) => void;
  export let onAddProject: () => void;
  export let onNewWorkspace: (projectId: string) => void;
  export let onNewFloatingWorkspace: () => void;

  // Group currently-open workspaces by project ID
  function openWorkspacesForProject(
    projectId: string,
    allWs: Workspace[],
  ): Workspace[] {
    return allWs.filter((ws) => ws.record?.projectId === projectId);
  }

  $: allAgents = getAgentsFromWorkspaces($workspaces);

  // Group agents by project for display
  $: agentGroups = (() => {
    const groups = new Map<string, { name: string; agents: AgentInfo[] }>();
    for (const agent of allAgents) {
      const key = agent.projectId || "__personal__";
      if (!groups.has(key)) {
        const proj = agent.projectId
          ? $projects.find((p) => p.id === agent.projectId)
          : null;
        groups.set(key, {
          name: proj?.name || "Personal",
          agents: [],
        });
      }
      groups.get(key)!.agents.push(agent);
    }
    return Array.from(groups.entries()).map(([id, g]) => ({
      id,
      name: g.name,
      agents: g.agents,
    }));
  })();

  function projectColor(projectId: string | undefined): string | null {
    if (!projectId) return null;
    return $projects.find((p) => p.id === projectId)?.color ?? null;
  }
</script>

<div
  class="home-screen"
  style="
    flex: 1; display: flex; flex-direction: column;
    background: {$theme.sidebarBg}; color: {$theme.fg};
    overflow: hidden;
  "
>
  <!-- Scrollable content -->
  <div
    style="flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 960px; margin: 0 auto; width: 100%;"
  >
    <!-- Terminals section -->
    <div
      style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;"
    >
      <h2
        style="font-size: 14px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
      >
        Terminals
      </h2>
      <button
        class="add-project-btn"
        style="font-size: 11px; padding: 4px 10px; border-radius: 4px; border: 1px solid {$theme.border}; cursor: pointer; color: {$theme.fg}; background: none;"
        on:click={onNewFloatingWorkspace}>+ New Terminal</button
      >
    </div>
    {#if $floatingWorkspaces.length > 0}
      <div
        style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;"
      >
        {#each $floatingWorkspaces as { ws } (ws.id)}
          <button
            style="
            background: {$theme.bgSurface}; border: 1px solid {$theme.border};
            border-left: 3px solid {$theme.fgMuted}; border-radius: 8px;
            padding: 12px 16px; min-width: 180px; cursor: pointer;
            color: {$theme.fg}; font-size: 13px; text-align: left;
          "
            on:click={() => onSwitchToWorkspace(ws.id)}>{ws.name}</button
          >
        {/each}
      </div>
    {:else}
      <div style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0 24px;">
        No terminals
      </div>
    {/if}

    <!-- Agents section -->
    {#if allAgents.length > 0}
      <div
        style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;"
      >
        <h2
          style="font-size: 14px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
        >
          Agents
          <span style="font-weight: 400; color: {$theme.fgDim};">
            ({allAgents.length})</span
          >
        </h2>
      </div>
      {#each agentGroups as group (group.id)}
        <div
          style="font-size: 11px; font-weight: 600; color: {$theme.fgDim}; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;"
        >
          {group.name}
        </div>
        <div
          style="display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;"
        >
          {#each group.agents as agent (agent.surfaceId)}
            {@const pColor = projectColor(agent.projectId)}
            <button
              style="
              background: {$theme.bgSurface}; border: 1px solid {$theme.border};
              border-left: 3px solid {agentStatusColor(
                agent.status,
                $theme,
              )}; border-radius: 8px;
              padding: 12px 16px; min-width: 180px; cursor: pointer;
              color: {$theme.fg}; text-align: left;
              display: flex; flex-direction: column; gap: 4px;
            "
              on:click={() => onSwitchToWorkspace(agent.workspaceId)}
            >
              <div style="display: flex; align-items: center; gap: 6px;">
                <span
                  style="width: 8px; height: 8px; border-radius: 50%; background: {agentStatusColor(
                    agent.status,
                    $theme,
                  )}; flex-shrink: 0;"
                  title={agentStatusLabel(agent.status)}
                ></span>
                <span
                  style="font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >
                  {agent.title}
                </span>
              </div>
              <div
                style="display: flex; align-items: center; gap: 4px; font-size: 10px;"
              >
                {#if pColor}
                  <span
                    style="width: 6px; height: 6px; border-radius: 50%; background: {pColor}; flex-shrink: 0;"
                  ></span>
                {/if}
                <span
                  style="color: {$theme.fgDim}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >
                  {agent.branch || agent.workspaceName}
                </span>
                <span
                  style="margin-left: auto; padding: 0 5px; border-radius: 8px; background: {agentStatusColor(
                    agent.status,
                    $theme,
                  )}20; color: {agentStatusColor(
                    agent.status,
                    $theme,
                  )}; flex-shrink: 0;"
                >
                  {agentStatusLabel(agent.status)}
                </span>
              </div>
            </button>
          {/each}
        </div>
      {/each}
    {/if}

    <!-- Projects section -->
    <div
      style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;"
    >
      <h2
        style="font-size: 14px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
      >
        Projects
      </h2>
      <button
        class="add-project-btn"
        style="font-size: 11px; padding: 4px 10px; border-radius: 4px; border: 1px solid {$theme.border}; cursor: pointer; color: {$theme.fg}; background: none;"
        on:click={onAddProject}>+ New Project</button
      >
    </div>
    {#if $activeProjects.length > 0}
      <div
        style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;"
      >
        {#each $activeProjects as project (project.id)}
          <ProjectCard
            {project}
            openWorkspaces={openWorkspacesForProject(project.id, $workspaces)}
            {onSwitchToWorkspace}
            {onNewWorkspace}
            onOpenDashboard={goToProject}
          />
        {/each}
      </div>
    {:else}
      <div style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0 24px;">
        No projects
      </div>
    {/if}
  </div>
</div>

<style>
  .add-project-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }
</style>
