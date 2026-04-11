<script lang="ts">
  import { getContext } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type WorkspaceActionContext,
  } from "../api";
  import type { ProjectEntry } from "./index";

  export let projectId: string;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;

  let project: ProjectEntry | undefined;

  // Re-read project data whenever workspaces change (most common trigger
  // for state updates, since state is not a store).
  $: {
    void $workspacesStore;
    const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
    project = projects.find((p) => p.id === projectId);
  }

  $: workspaceMap = new Map($workspacesStore.map((w) => [w.id, w]));

  $: projectContext = project
    ? ({
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        isGit: project.isGit,
      } satisfies WorkspaceActionContext)
    : undefined;

  $: actions = projectContext
    ? api
        .getWorkspaceActions()
        .filter((a) => !a.when || a.when(projectContext!))
    : [];

  function actionTooltip(action: { label: string; shortcut?: string }): string {
    return action.shortcut
      ? `${action.label} (${action.shortcut})`
      : action.label;
  }
</script>

{#if project}
  <div style="padding: 2px 0; font-size: 12px; color: {$theme.fg};">
    <!-- Workspace list -->
    {#each project.workspaceIds as wsId (wsId)}
      {@const ws = workspaceMap.get(wsId)}
      {#if ws}
        <div
          style="
            padding: 2px 8px; font-size: 11px;
            color: {$theme.fgDim}; cursor: default;
            overflow: hidden; text-overflow: ellipsis;
            white-space: nowrap;
          "
        >
          {ws.name}
        </div>
      {/if}
    {/each}

    {#if project.workspaceIds.length === 0}
      <div
        style="
          padding: 2px 8px; font-size: 10px;
          color: {$theme.fgDim}; font-style: italic;
        "
      >
        No workspaces
      </div>
    {/if}

    <!-- Workspace action buttons -->
    {#if actions.length > 0}
      <div
        style="
          display: flex; gap: 4px; padding: 4px 8px;
          flex-wrap: wrap;
        "
      >
        {#each actions as action (action.id)}
          <button
            title={actionTooltip(action)}
            on:click={() => action.handler(projectContext)}
            style="
              padding: 2px 6px; border: 1px solid {$theme.border};
              background: transparent; color: {$theme.fgDim};
              border-radius: 3px; cursor: pointer; font-size: 10px;
              display: flex; align-items: center; gap: 3px;
            "
          >
            {action.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}
