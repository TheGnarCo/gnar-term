<script lang="ts">
  import { theme } from "../stores/theme";
  import { currentView, currentProjectId, sidebarVisible } from "../stores/ui";
  import {
    workspaces,
    activeWorkspace,
    notifyWorkspacesChanged,
  } from "../stores/workspace";
  import { projects } from "../stores/project";

  const isMac =
    typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  const chromeOffset = isMac ? "78px" : "12px";

  $: isDashboard = $currentView === "home" || $workspaces.length === 0;
  $: ws = $activeWorkspace;
  $: projectId = ws?.record?.projectId;
  $: project = projectId ? $projects.find((p) => p.id === projectId) : null;
  $: wsType = ws?.record?.type;

  $: viewProject = $currentProjectId
    ? $projects.find((p) => p.id === $currentProjectId)
    : null;

  $: titleText = (() => {
    if ($currentView === "settings") return "Settings";
    if ($currentView === "project" && viewProject)
      return `${viewProject.name} Dashboard`;
    if (isDashboard) return "GnarTerm";
    if (!ws) return "";
    if (project) {
      const typeLabel = wsType === "managed" ? "Managed Workspace" : "Terminal";
      return `${project.name}  >  ${ws.name} (${typeLabel})`;
    }
    return `${ws.name} (Workspace)`;
  })();

  function openSettings() {
    currentView.set("settings");
  }
</script>

<div
  data-tauri-drag-region=""
  style="
    height: 30px; flex-shrink: 0; display: flex; align-items: center;
    padding: 0 12px 0 {chromeOffset}; -webkit-app-region: drag;
    background: {$theme.sidebarBg}; border-bottom: 1px solid {$theme.bg};
    position: relative;
  "
>
  <!-- Center: title (absolutely positioned for true centering) -->
  <div
    style="
    position: absolute; left: 0; right: 0; top: 0; bottom: 0;
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  "
  >
    <span
      style="
      font-size: {isDashboard ? '13px' : '12px'};
      font-weight: {isDashboard ? '600' : '500'};
      color: {isDashboard ? $theme.fg : $theme.fgMuted};
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      max-width: 60%;
    ">{titleText}</span
    >
  </div>

  <!-- Left: spacer (traffic lights) -->
  <div style="flex-shrink: 0;"></div>

  <!-- Right: actions (pushed to end) -->
  <div
    style="margin-left: auto; display: flex; align-items: center; gap: 4px; -webkit-app-region: no-drag; z-index: 1;"
  >
    <button
      title="{$sidebarVisible ? 'Hide' : 'Show'} Sidebar (⌘B)"
      style="background: none; border: none; cursor: pointer; padding: 4px; color: {$sidebarVisible
        ? $theme.fg
        : $theme.fgDim}; display: flex; align-items: center; border-radius: 4px;"
      on:click={() => sidebarVisible.update((v) => !v)}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        ><rect x="1" y="2" width="14" height="12" rx="1.5" /><line
          x1="5.5"
          y1="2"
          x2="5.5"
          y2="14"
        /></svg
      >
    </button>
    {#if ws?.record?.projectId}
      <button
        title="{ws.rightSidebarOpen ? 'Hide' : 'Show'} Right Sidebar"
        style="background: none; border: none; cursor: pointer; padding: 4px; color: {ws.rightSidebarOpen
          ? $theme.fg
          : $theme.fgDim}; display: flex; align-items: center; border-radius: 4px;"
        on:click={() => {
          ws.rightSidebarOpen = !ws.rightSidebarOpen;
          notifyWorkspacesChanged();
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          ><rect x="1" y="2" width="14" height="12" rx="1.5" /><line
            x1="10.5"
            y1="2"
            x2="10.5"
            y2="14"
          /></svg
        >
      </button>
    {/if}

    <button
      title="Settings"
      style="background: none; border: none; cursor: pointer; padding: 4px; color: {$theme.fgDim}; display: flex; align-items: center; border-radius: 4px;"
      on:click={openSettings}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path
          d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"
        />
        <path
          d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.902 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 002.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 001.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 00-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 00-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 00-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291a1.873 1.873 0 00-1.116-2.693l-.318-.094c-.835-.246-.835-1.428 0-1.674l.319-.094a1.873 1.873 0 001.115-2.692l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 002.692-1.116l.094-.318z"
        />
      </svg>
    </button>
  </div>
</div>
