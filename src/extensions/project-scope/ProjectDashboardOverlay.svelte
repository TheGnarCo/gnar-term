<script lang="ts">
  import { getContext, type Component } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    resolveProjectColor,
    PROJECT_COLOR_SLOTS,
  } from "../api";
  import { dashboardProjectId$ } from "./index";
  import { getProjects, updateProject, deleteProject } from "./project-service";

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const workspacesStore = api.workspaces;
  const { ColorPicker } = api.getComponents();
  const activeWs = api.activeWorkspace;

  $: dashboardProjectId = $dashboardProjectId$;

  // Bump on `extension:project:state-changed` so the dashboard re-reads
  // projects after saves (the api.state write alone is invisible to
  // reactive blocks — only workspace-store changes would otherwise
  // trigger a re-read).
  let projectStateVersion = 0;
  api.on("extension:project:state-changed", () => {
    projectStateVersion++;
  });

  $: project = dashboardProjectId
    ? getProjects(api).find((p) => p.id === dashboardProjectId)
    : undefined;

  // Re-read project data when workspaces change or project state updates.
  $: {
    void $workspacesStore;
    void projectStateVersion;
    if (dashboardProjectId) {
      project = getProjects(api).find((p) => p.id === dashboardProjectId);
    }
  }

  $: visible = !!dashboardProjectId && !!project;

  // Resolved hex for the active project's slot-or-hex color. Referenced
  // everywhere the dashboard paints the project color (header dot, tab
  // underline, workspace accent border, etc.) so slot selections follow
  // the theme and custom hexes render unchanged.
  $: projectHex = project ? resolveProjectColor(project.color, $theme) : "";

  type TabId = "overview" | "workspaces" | "settings" | string;
  let activeTab: TabId = "overview";

  // Reset tab when dashboard opens
  $: if (dashboardProjectId) {
    activeTab = "overview";
    api.emit("extension:project:dashboard-opened", {
      projectId: dashboardProjectId,
    });
  }

  // Extension-contributed tabs
  $: extensionTabs = api.getDashboardTabs().map((tab) => ({
    id: tab.id,
    label: tab.label,
    component: tab.component,
    props: tab.props,
  }));

  const coreTabs: Array<{ id: TabId; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "workspaces", label: "Workspaces" },
  ];
  const settingsTab = { id: "settings" as TabId, label: "Settings" };
  $: allTabs = [...coreTabs, ...extensionTabs, settingsTab];

  function close() {
    dashboardProjectId$.set(null);
  }

  function handleBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains("dashboard-overlay")) {
      close();
    }
  }

  // ---- Overview tab data ----
  $: workspaceCount = project
    ? $workspacesStore.filter((ws) => project!.workspaceIds.includes(ws.id))
        .length
    : 0;

  // ---- Workspaces tab ----
  $: projectWorkspaces = project
    ? $workspacesStore.filter((ws) => project!.workspaceIds.includes(ws.id))
    : [];

  function switchToWorkspace(wsId: string) {
    api.switchWorkspace(wsId);
    close();
  }

  function newWorkspace() {
    if (!project) return;
    api.createWorkspace(
      `Workspace ${project.workspaceIds.length + 1}`,
      project.path,
      { metadata: { projectId: project.id } },
    );
  }

  // ---- Settings tab ----
  let editName = "";
  let editColor = "";
  let confirmingDelete = false;

  $: if (project) {
    editName = project.name;
    editColor = project.color;
    confirmingDelete = false;
  }

  $: hasChanges =
    project && (editName !== project.name || editColor !== project.color);

  function saveChanges() {
    if (!project || !hasChanges) return;
    updateProject(api, project.id, {
      name: editName.trim(),
      color: editColor,
    });
  }

  function confirmDelete() {
    if (!confirmingDelete) {
      confirmingDelete = true;
      return;
    }
    deleteProject(api, project!.id);
    close();
  }
</script>

{#if visible && project}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="dashboard-overlay"
    on:click={handleBackdropClick}
    on:keydown={(e) => {
      if (e.key === "Escape") close();
    }}
    role="dialog"
    aria-label="Project Dashboard"
    tabindex="-1"
    style="
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
    "
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      on:click|stopPropagation
      on:keydown|stopPropagation
      style="
        width: 720px; max-width: 90vw;
        height: 520px; max-height: 80vh;
        background: {$theme.bg};
        border: 1px solid {$theme.border};
        border-radius: 12px;
        display: flex; flex-direction: column; overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      "
    >
      <!-- Header -->
      <div
        style="display: flex; align-items: center; gap: 10px; padding: 16px 20px 0; flex-shrink: 0;"
      >
        <div
          style="width: 12px; height: 12px; border-radius: 50%; background: {projectHex}; flex-shrink: 0;"
        ></div>
        <div style="font-size: 16px; font-weight: 600; color: {$theme.fg};">
          {project.name}
        </div>
        <div style="flex: 1;"></div>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span
          style="cursor: pointer; color: {$theme.fgDim}; font-size: 18px; padding: 2px 6px; border-radius: 4px;"
          on:click={close}
          title="Close (Escape)">×</span
        >
      </div>

      <!-- Tab bar -->
      <div
        style="display: flex; gap: 0; padding: 12px 20px 0; border-bottom: 1px solid {$theme.border}; flex-shrink: 0;"
      >
        {#each allTabs as tab (tab.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            style="
              padding: 8px 16px; font-size: 12px; cursor: pointer;
              color: {activeTab === tab.id ? $theme.fg : $theme.fgDim};
              font-weight: {activeTab === tab.id ? '600' : '400'};
              border-bottom: 2px solid {activeTab === tab.id
              ? projectHex
              : 'transparent'};
              margin-bottom: -1px; transition: color 0.1s, border-color 0.1s;
            "
            on:click={() => (activeTab = tab.id)}
          >
            {tab.label}
          </div>
        {/each}
      </div>

      <!-- Tab content -->
      <div style="flex: 1; overflow-y: auto; padding: 20px;">
        {#if activeTab === "overview"}
          <!-- Overview -->
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div
                style="width: 10px; height: 10px; border-radius: 50%; background: {projectHex};"
              ></div>
              <div
                style="font-size: 11px; color: {$theme.fgDim}; font-family: monospace;"
              >
                {project.path}
              </div>
            </div>
            <div style="display: flex; gap: 12px;">
              <div
                style="flex: 1; background: {$theme.bgSurface}; border: 1px solid {$theme.border}; border-radius: 8px; padding: 14px; text-align: center;"
              >
                <div
                  style="font-size: 22px; font-weight: 700; color: {$theme.fg};"
                >
                  {workspaceCount}
                </div>
                <div
                  style="font-size: 11px; color: {$theme.fgDim}; margin-top: 2px;"
                >
                  Workspaces
                </div>
              </div>
              <div
                style="flex: 1; background: {$theme.bgSurface}; border: 1px solid {$theme.border}; border-radius: 8px; padding: 14px; text-align: center;"
              >
                <div
                  style="font-size: 14px; font-weight: 600; color: {project.isGit
                    ? '#98c379'
                    : $theme.fgDim};"
                >
                  {project.isGit ? "Git" : "No Git"}
                </div>
                <div
                  style="font-size: 11px; color: {$theme.fgDim}; margin-top: 2px;"
                >
                  {project.isGit ? "Repository" : "Not a repo"}
                </div>
              </div>
            </div>
            <div style="font-size: 11px; color: {$theme.fgDim};">
              Created {new Date(project.createdAt).toLocaleDateString()}
            </div>
          </div>
        {:else if activeTab === "workspaces"}
          <!-- Workspaces -->
          <div style="display: flex; flex-direction: column; gap: 4px;">
            {#each projectWorkspaces as ws (ws.id)}
              {@const isActive = $activeWs?.id === ws.id}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                style="
                  display: flex; align-items: center; gap: 8px;
                  padding: 8px 12px; border-radius: 6px; cursor: pointer;
                  background: {isActive ? $theme.bgActive : 'transparent'};
                  border-left: 3px solid {isActive
                  ? projectHex
                  : `color-mix(in srgb, ${projectHex} 30%, transparent)`};
                "
                on:click={() => switchToWorkspace(ws.id)}
              >
                <span
                  style="
                    flex: 1; font-size: 13px;
                    font-weight: {isActive ? '600' : '400'};
                    color: {isActive ? $theme.fg : $theme.fgMuted};
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  ">{ws.name}</span
                >
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                  style="color: {$theme.fgDim}; cursor: pointer; font-size: 14px; padding: 0 2px;"
                  title="Close workspace"
                  on:click|stopPropagation={() => api.closeWorkspace(ws.id)}
                  >×</span
                >
              </div>
            {/each}
            {#if projectWorkspaces.length === 0}
              <div
                style="font-size: 12px; color: {$theme.fgDim}; font-style: italic; padding: 8px 0;"
              >
                No workspaces in this project
              </div>
            {/if}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              style="
                display: flex; align-items: center; justify-content: center;
                padding: 8px 12px; border-radius: 6px; cursor: pointer;
                border: 1px dashed {$theme.border}; color: {$theme.fgDim};
                font-size: 12px; margin-top: 4px;
              "
              on:click={newWorkspace}
            >
              + New Workspace
            </div>
          </div>
        {:else if activeTab === "settings"}
          <!-- Settings -->
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label
                for="dash-name"
                style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
                >Project Name</label
              >
              <input
                id="dash-name"
                type="text"
                bind:value={editName}
                style="
                  padding: 8px 12px; background: {$theme.bg};
                  border: 1px solid {$theme.borderActive}; border-radius: 6px;
                  color: {$theme.fg}; font-size: 13px;
                  outline: none; font-family: inherit; width: 100%; box-sizing: border-box;
                "
              />
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span
                style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
                >Color</span
              >
              <svelte:component
                this={ColorPicker as Component}
                bind:value={editColor}
                colors={PROJECT_COLOR_SLOTS}
                resolveColor={(c: string) => resolveProjectColor(c, $theme)}
                {theme}
              />
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span
                style="font-size: 12px; color: {$theme.fgDim}; font-weight: 500;"
                >Path</span
              >
              <div
                style="
                  padding: 8px 12px; background: {$theme.bgSurface};
                  border: 1px solid {$theme.border}; border-radius: 6px;
                  color: {$theme.fgMuted}; font-size: 12px; font-family: monospace;
                "
              >
                {project.path}
              </div>
            </div>
            {#if hasChanges}
              <div style="display: flex; justify-content: flex-end;">
                <button
                  on:click={saveChanges}
                  style="
                    padding: 6px 16px; border-radius: 6px; border: none;
                    background: {$theme.accent}; color: white;
                    cursor: pointer; font-size: 13px;
                  ">Save Changes</button
                >
              </div>
            {/if}
            <div
              style="margin-top: 16px; padding-top: 16px; border-top: 1px solid {$theme.border};"
            >
              <div
                style="font-size: 12px; color: {$theme.danger}; font-weight: 600; margin-bottom: 8px;"
              >
                Danger Zone
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <button
                  on:click={confirmDelete}
                  style="
                    padding: 6px 16px; border-radius: 6px;
                    border: 1px solid {$theme.danger};
                    background: {confirmingDelete
                    ? $theme.danger
                    : 'transparent'};
                    color: {confirmingDelete ? 'white' : $theme.danger};
                    cursor: pointer; font-size: 13px;
                  "
                >
                  {confirmingDelete ? "Confirm Delete" : "Delete Project"}
                </button>
                {#if confirmingDelete}
                  <button
                    on:click={() => (confirmingDelete = false)}
                    style="
                      padding: 6px 12px; border-radius: 6px;
                      border: 1px solid {$theme.border};
                      background: transparent; color: {$theme.fgMuted};
                      cursor: pointer; font-size: 12px;
                    ">Cancel</button
                  >
                {/if}
              </div>
              <div
                style="font-size: 11px; color: {$theme.fgDim}; margin-top: 4px;"
              >
                This removes the project grouping. Workspaces will not be
                closed.
              </div>
            </div>
          </div>
        {:else}
          <!-- Extension-contributed tab -->
          {#each extensionTabs as tab (tab.id)}
            {#if tab.id === activeTab}
              <svelte:component
                this={tab.component as Component}
                {...tab.props ?? {}}
                projectId={project.id}
              />
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
