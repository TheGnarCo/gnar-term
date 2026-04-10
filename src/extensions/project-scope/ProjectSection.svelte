<script lang="ts">
  import { getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../api";
  import { createProjectViaPrompt, type ProjectEntry } from "./index";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;

  let projects: ProjectEntry[] = [];
  let activeProjectId: string | null = null;
  let expandedIds: Set<string> = new Set();

  // Poll state on each reactive tick (state is not a store, so we
  // re-read it whenever workspaces change — the most common trigger).
  $: {
    void $workspacesStore;
    projects = api.state.get<ProjectEntry[]>("projects") ?? [];
    activeProjectId = api.state.get<string | null>("activeProjectId") ?? null;
  }

  $: workspaceMap = new Map($workspacesStore.map((w) => [w.id, w]));

  $: assignedIds = new Set(projects.flatMap((p) => p.workspaceIds));
  $: floatingWorkspaces = $workspacesStore.filter(
    (w) => !assignedIds.has(w.id),
  );

  function toggleExpand(id: string) {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
    expandedIds = expandedIds;
  }

  function setActiveProject(id: string) {
    const newId = activeProjectId === id ? null : id;
    api.state.set("activeProjectId", newId);
    activeProjectId = newId;
  }

  async function createProject() {
    await createProjectViaPrompt(api);
    // Re-read state after creation
    projects = api.state.get<ProjectEntry[]>("projects") ?? [];
    activeProjectId = api.state.get<string | null>("activeProjectId") ?? null;
  }
</script>

<div style="padding: 4px 0; font-size: 12px; color: {$theme.fg};">
  <button
    on:click={createProject}
    style="
      display: block; width: calc(100% - 16px); margin: 4px 8px;
      padding: 4px 8px; border: 1px solid {$theme.border};
      background: transparent; color: {$theme.fg};
      border-radius: 3px; cursor: pointer; font-size: 11px;
      text-align: left;
    "
  >
    + New Project
  </button>

  {#each projects as project (project.id)}
    {@const isActive = activeProjectId === project.id}
    {@const isExpanded = expandedIds.has(project.id)}
    <div style="margin-top: 2px;">
      <div
        role="button"
        tabindex="0"
        on:click={() => toggleExpand(project.id)}
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key === " ") toggleExpand(project.id);
        }}
        style="
          display: flex; align-items: center; gap: 6px;
          padding: 3px 8px; cursor: pointer;
          background: {isActive ? project.color + '18' : 'transparent'};
          border-left: 2px solid {isActive ? project.color : 'transparent'};
        "
      >
        <span
          style="
            display: inline-block; width: 8px; height: 8px;
            border-radius: 50%; background: {project.color};
            flex-shrink: 0;
          "
        ></span>
        <span
          role="button"
          tabindex="0"
          on:click|stopPropagation={() => setActiveProject(project.id)}
          on:keydown|stopPropagation={(e) => {
            if (e.key === "Enter" || e.key === " ")
              setActiveProject(project.id);
          }}
          style="
            font-weight: 600; flex: 1; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap;
          "
        >
          {project.name}
        </span>
        <span style="font-size: 10px; color: {$theme.fgDim};">
          {isExpanded ? "\u25BC" : "\u25B6"}
        </span>
      </div>

      {#if isExpanded}
        <div style="padding-left: 24px;">
          {#each project.workspaceIds as wsId (wsId)}
            {@const ws = workspaceMap.get(wsId)}
            {#if ws}
              <div
                style="
                  padding: 2px 4px; font-size: 11px;
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
                padding: 2px 4px; font-size: 10px;
                color: {$theme.fgDim}; font-style: italic;
              "
            >
              No workspaces
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if floatingWorkspaces.length > 0}
    <div
      style="
        margin-top: 8px; padding: 3px 8px;
        font-size: 10px; color: {$theme.fgDim};
        text-transform: uppercase; letter-spacing: 0.5px;
      "
    >
      Floating
    </div>
    {#each floatingWorkspaces as ws (ws.id)}
      <div
        style="
          padding: 2px 8px 2px 24px; font-size: 11px;
          color: {$theme.fgDim}; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        "
      >
        {ws.name}
      </div>
    {/each}
  {/if}

  {#if projects.length === 0 && floatingWorkspaces.length === 0}
    <div
      style="
        padding: 8px; font-size: 11px;
        color: {$theme.fgDim}; text-align: center;
      "
    >
      No projects yet
    </div>
  {/if}
</div>
