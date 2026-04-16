<script lang="ts">
  import { getContext, type Component } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type WorkspaceActionContext,
  } from "../api";
  import type { ProjectEntry } from "./index";
  import { dashboardProjectId$ } from "./index";

  export let projectId: string;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;
  const { WorkspaceListView, SplitButton } = api.getComponents();

  let project: ProjectEntry | undefined;
  let stateVersion = 0;

  // Re-read when project state changes (not reactive — force via event)
  api.on("extension:project:state-changed", () => {
    stateVersion++;
  });

  // Re-read project data whenever workspaces change or project state is updated
  $: {
    void $workspacesStore;
    void stateVersion;
    const projects = api.state.get<ProjectEntry[]>("projects") ?? [];
    project = projects.find((p) => p.id === projectId);
  }

  $: filterIds = project ? new Set(project.workspaceIds) : new Set<string>();

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

  $: coreAction = actions.find((a) => a.id === "core:new-workspace");
  $: otherActions = actions.filter((a) => a.id !== "core:new-workspace");

  $: splitDropdownItems = [
    {
      id: "new-workspace",
      label: "New Workspace",
      icon: "plus",
      handler: () => {
        if (coreAction && projectContext)
          void coreAction.handler(projectContext);
      },
    },
    ...otherActions.map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      handler: () => {
        void a.handler(projectContext!);
      },
    })),
  ];
</script>

{#if project}
  <div style="padding: 2px 0; font-size: 12px; color: {$theme.fg};">
    <!-- Project header with SplitButton matching Workspaces section -->
    <div
      style="
        padding: 6px 12px; font-size: 10px; font-weight: 600;
        letter-spacing: 0.5px; text-transform: uppercase;
        color: {$theme.fgDim};
        display: flex; align-items: center; justify-content: space-between;
        border-left: 3px solid {project.color};
      "
    >
      <span>{project.name}</span>
      {#if coreAction}
        <span
          style="text-transform: none; letter-spacing: normal; font-weight: 400;"
        >
          <svelte:component
            this={SplitButton as Component}
            label="+ New"
            onMainClick={() => coreAction?.handler(projectContext ?? {})}
            dropdownItems={splitDropdownItems}
            {theme}
          />
        </span>
      {/if}
    </div>

    <!-- Dashboard link -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        padding: 3px 12px 4px; font-size: 10px; color: {$theme.fgDim};
        cursor: pointer; border-left: 3px solid {project.color};
      "
      on:click={() => {
        if (project) dashboardProjectId$.set(project.id);
      }}
    >
      <span
        style="
          border: 1px solid {$theme.border}; border-radius: 4px;
          padding: 2px 8px; display: inline-block;
        "
      >
        Dashboard
      </span>
    </div>

    <!-- Workspace list -->
    <svelte:component
      this={WorkspaceListView as Component}
      {filterIds}
      accentColor={project.color}
    />
  </div>
{/if}
