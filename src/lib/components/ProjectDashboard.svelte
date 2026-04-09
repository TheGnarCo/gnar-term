<script lang="ts">
  import { theme } from "../stores/theme";
  import { currentProjectId, goHome, goToProjectSettings } from "../stores/ui";
  import { workspaces } from "../stores/workspace";
  import { projects, setProjectColor } from "../stores/project";
  import { PROJECT_COLORS } from "../state";
  import type { GhIssue, GhPullRequest } from "../git";
  import {
    getAgentsFromWorkspaces,
    agentStatusColor,
    agentStatusLabel,
  } from "../agent-utils";

  export let onSwitchToWorkspace: (wsId: string) => void;
  export let onNewWorkspace: (projectId: string) => void;

  let showColorPicker = false;
  let gitActionStatus = "";
  let issues: GhIssue[] = [];
  let prs: GhPullRequest[] = [];
  let issuesLoading = false;
  let prsLoading = false;
  let issuesError = "";
  let prsError = "";

  $: project = $projects.find((p) => p.id === $currentProjectId) || null;
  $: projectWorkspaces = $workspaces.filter(
    (ws) => ws.record?.projectId === $currentProjectId,
  );
  $: managedWs = projectWorkspaces.filter(
    (ws) => ws.record?.type === "managed",
  );
  $: terminalWs = projectWorkspaces.filter(
    (ws) => ws.record?.type === "terminal",
  );
  $: projectAgents = getAgentsFromWorkspaces(projectWorkspaces);

  let lastFetchedProjectId = "";
  $: if (project?.gitBacked && project.id !== lastFetchedProjectId) {
    lastFetchedProjectId = project.id;
    // Clear stale data immediately
    issues = [];
    prs = [];
    issuesError = "";
    prsError = "";
    fetchGitHub(project.path);
  }

  async function fetchGitHub(projectPath: string) {
    issuesLoading = true;
    prsLoading = true;
    issuesError = "";
    prsError = "";
    issues = [];
    prs = [];
    const git = await import("../git");
    const [issueResult, prResult] = await Promise.allSettled([
      git.ghListIssues(projectPath),
      git.ghListPrs(projectPath),
    ]);
    if (issueResult.status === "fulfilled") {
      issues = issueResult.value;
    } else {
      issuesError = `${issueResult.reason}`;
    }
    issuesLoading = false;
    if (prResult.status === "fulfilled") {
      prs = prResult.value;
    } else {
      prsError = `${prResult.reason}`;
    }
    prsLoading = false;
  }

  function openUrl(url: string) {
    import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("open_with_default_app", { path: url }),
    );
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const days = Math.floor(hr / 24);
    return `${days}d`;
  }

  async function gitFetchAll() {
    if (!project) return;
    gitActionStatus = "Fetching...";
    try {
      const { fetchAll } = await import("../git");
      await fetchAll(project.path);
      gitActionStatus = "Fetched all remotes";
      fetchGitHub(project.path);
    } catch (err) {
      gitActionStatus = `Fetch failed: ${err}`;
    }
    setTimeout(() => {
      gitActionStatus = "";
    }, 3000);
  }

  function pickColor(color: string) {
    if (project) {
      setProjectColor(project.id, color);
      showColorPicker = false;
    }
  }

  async function handleSendToAgent(issue: GhIssue) {
    if (!project) return;
    const { sendIssueToAgent } = await import("../workspace-actions");
    await sendIssueToAgent(project.id, project.path, issue);
  }
</script>

<div
  style="
    flex: 1; display: flex; flex-direction: column;
    background: {$theme.sidebarBg}; color: {$theme.fg};
    overflow: hidden;
  "
>
  <div
    style="flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 1100px; margin: 0 auto; width: 100%;"
  >
    {#if project}
      <!-- Breadcrumb -->
      <div
        style="display: flex; align-items: center; gap: 6px; margin-bottom: 16px; font-size: 12px;"
      >
        <button
          class="breadcrumb-link"
          style="background: none; border: none; color: {$theme.fgMuted}; cursor: pointer; padding: 0; font-size: 12px;"
          on:click={goHome}>Dashboard</button
        >
        <span style="color: {$theme.fgDim};">/</span>
        <span style="color: {$theme.fg}; font-weight: 500;">{project.name}</span
        >
      </div>

      <!-- Project header -->
      <div
        style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;"
      >
        <div style="position: relative;">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            style="width: 14px; height: 14px; border-radius: 50%; background: {project.color}; flex-shrink: 0; display: block; cursor: pointer; border: 2px solid transparent;"
            title="Change project color"
            on:click={() => (showColorPicker = !showColorPicker)}
          ></span>
          {#if showColorPicker}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              style="
                position: absolute; top: 22px; left: 0; z-index: 100;
                background: {$theme.bgFloat}; border: 1px solid {$theme.border};
                border-radius: 8px; padding: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                display: flex; flex-wrap: wrap; gap: 6px; width: 156px;
              "
              on:click|stopPropagation
            >
              {#each PROJECT_COLORS as c}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                  style="
                    width: 20px; height: 20px; border-radius: 50%; background: {c}; cursor: pointer;
                    border: 2px solid {c === project.color
                    ? $theme.fg
                    : 'transparent'};
                  "
                  on:click={() => pickColor(c)}
                ></span>
              {/each}
            </div>
          {/if}
        </div>
        <h1 style="font-size: 20px; font-weight: 600; margin: 0; flex: 1;">
          {project.name}
        </h1>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          style="cursor: pointer; color: {$theme.fgMuted}; padding: 4px;"
          title="Project settings"
          on:click={() => goToProjectSettings(project.id)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"
            ><path
              d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"
            /><path
              d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.421 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.421-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"
            /></svg
          >
        </span>
      </div>
      <div
        style="font-size: 12px; color: {$theme.fgDim}; margin-bottom: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
      >
        {project.path}
      </div>

      <!-- Git actions -->
      {#if project.gitBacked}
        <div
          style="display: flex; align-items: center; gap: 8px; margin-bottom: 20px;"
        >
          <button
            class="action-btn"
            style="font-size: 11px; padding: 4px 10px; border-radius: 4px; border: 1px solid {$theme.border}; background: none; color: {$theme.fgMuted}; cursor: pointer;"
            on:click={gitFetchAll}>Fetch All Remotes</button
          >
          {#if gitActionStatus}
            <span style="font-size: 11px; color: {$theme.fgDim};"
              >{gitActionStatus}</span
            >
          {/if}
        </div>
      {/if}

      <!-- Workspaces — unified list -->
      <div
        style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;"
      >
        <h2
          style="font-size: 13px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
        >
          Workspaces
          {#if projectWorkspaces.length > 0}<span
              style="font-weight: 400; color: {$theme.fgDim};"
            >
              ({projectWorkspaces.length})</span
            >{/if}
        </h2>
        <button
          class="action-btn"
          style="font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid {$theme.border}; background: none; color: {$theme.fgMuted}; cursor: pointer;"
          on:click={() => onNewWorkspace(project.id)}>+ New</button
        >
      </div>
      {#if projectWorkspaces.length > 0}
        <div
          style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px;"
        >
          {#if managedWs.length > 0}
            <div
              style="font-size: 10px; font-weight: 600; color: {$theme.fgDim}; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 0 2px;"
            >
              Managed
            </div>
            {#each managedWs as ws (ws.id)}
              <button
                class="ws-row"
                style="
                  width: 100%; background: {$theme.bgSurface}; border: 1px solid {$theme.border};
                  border-left: 3px solid {project.color}; border-radius: 6px;
                  padding: 8px 12px; cursor: pointer; text-align: left;
                  display: flex; align-items: center; gap: 8px; color: {$theme.fg};
                "
                on:click={() => onSwitchToWorkspace(ws.id)}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill={$theme.fgMuted}
                  style="flex-shrink: 0;"
                >
                  <path
                    d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25z"
                  />
                </svg>
                <span
                  style="font-size: 12px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >
                  {ws.record?.branch || ws.name}
                </span>
              </button>
            {/each}
          {/if}
          {#if terminalWs.length > 0}
            <div
              style="font-size: 10px; font-weight: 600; color: {$theme.fgDim}; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 0 2px;"
            >
              Terminals
            </div>
            {#each terminalWs as ws (ws.id)}
              <button
                class="ws-row"
                style="
                  width: 100%; background: {$theme.bgSurface}; border: 1px solid {$theme.border};
                  border-left: 3px solid {$theme.fgMuted}; border-radius: 6px;
                  padding: 8px 12px; cursor: pointer; text-align: left;
                  display: flex; align-items: center; gap: 8px; color: {$theme.fg};
                "
                on:click={() => onSwitchToWorkspace(ws.id)}
              >
                <span style="font-size: 12px; font-weight: 500; flex: 1;"
                  >{ws.name}</span
                >
              </button>
            {/each}
          {/if}
        </div>
      {:else}
        <div
          style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0 16px;"
        >
          No workspaces
        </div>
      {/if}

      <!-- Agents section -->
      {#if projectAgents.length > 0}
        <div style="display: flex; align-items: center; margin-bottom: 10px;">
          <h2
            style="font-size: 13px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
          >
            Agents
            <span style="font-weight: 400; color: {$theme.fgDim};">
              ({projectAgents.length})</span
            >
          </h2>
        </div>
        <div
          style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 24px;"
        >
          {#each projectAgents as agent (agent.surfaceId)}
            <button
              class="ws-row"
              style="
                width: 100%; background: {$theme.bgSurface}; border: 1px solid {$theme.border};
                border-left: 3px solid {agentStatusColor(
                agent.status,
                $theme,
              )}; border-radius: 6px;
                padding: 8px 12px; cursor: pointer; text-align: left;
                display: flex; align-items: center; gap: 8px; color: {$theme.fg};
              "
              on:click={() => onSwitchToWorkspace(agent.workspaceId)}
            >
              <span
                style="width: 8px; height: 8px; border-radius: 50%; background: {agentStatusColor(
                  agent.status,
                  $theme,
                )}; flex-shrink: 0;"
                title={agentStatusLabel(agent.status)}
              ></span>
              <span
                style="font-size: 12px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              >
                {agent.title}
              </span>
              <span
                style="font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
              >
                {agent.branch || agent.workspaceName}
              </span>
              <span
                style="font-size: 10px; padding: 1px 6px; border-radius: 8px; background: {agentStatusColor(
                  agent.status,
                  $theme,
                )}20; color: {agentStatusColor(
                  agent.status,
                  $theme,
                )}; flex-shrink: 0;"
              >
                {agentStatusLabel(agent.status)}
              </span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Issues & PRs side by side -->
      {#if project.gitBacked}
        <div
          style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px;"
        >
          <!-- Issues column -->
          <div>
            <div
              style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;"
            >
              <h2
                style="font-size: 13px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
              >
                Issues
                {#if issues.length > 0}<span
                    style="font-weight: 400; color: {$theme.fgDim};"
                  >
                    ({issues.length})</span
                  >{/if}
              </h2>
              <button
                class="action-btn"
                style="font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid {$theme.border}; background: none; color: {$theme.fgMuted}; cursor: pointer;"
                disabled={issuesLoading}
                on:click={() => project && fetchGitHub(project.path)}
                >{issuesLoading ? "..." : "Refresh"}</button
              >
            </div>

            {#if issuesLoading && issues.length === 0}
              <div
                style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0;"
              >
                Loading...
              </div>
            {:else if issuesError}
              <div
                style="padding: 6px 10px; font-size: 11px; color: {$theme.danger}; background: rgba(255,0,0,0.05); border-radius: 4px;"
              >
                {issuesError}
              </div>
            {:else if issues.length === 0}
              <div
                style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0;"
              >
                No open issues
              </div>
            {:else}
              <div style="display: flex; flex-direction: column; gap: 4px;">
                {#each issues as issue (issue.number)}
                  <button
                    class="gh-card"
                    style="
                      width: 100%; background: {$theme.bgSurface}; border: 1px solid {$theme.border};
                      border-radius: 6px; padding: 8px 12px; cursor: pointer; text-align: left;
                      display: flex; flex-direction: column; gap: 3px; color: {$theme.fg};
                    "
                    on:click={() => openUrl(issue.url)}
                  >
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span
                        style="font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
                        >#{issue.number}</span
                      >
                      <span
                        style="font-size: 12px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                      >
                        {issue.title}
                      </span>
                      <span
                        style="font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
                        >{relativeTime(issue.updatedAt)}</span
                      >
                    </div>
                    <div
                      style="display: flex; align-items: center; gap: 4px; font-size: 10px;"
                    >
                      <span style="color: {$theme.fgDim};">{issue.author}</span>
                      {#each issue.labels as label}
                        <span
                          style="padding: 0 5px; border-radius: 8px; background: {$theme.accent}20; color: {$theme.accent}; border: 1px solid {$theme.accent}40;"
                          >{label}</span
                        >
                      {/each}
                      <span style="flex: 1;"></span>
                      <!-- svelte-ignore a11y_click_events_have_key_events -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="send-to-agent"
                        style="
                          padding: 1px 6px; border-radius: 4px; cursor: pointer;
                          border: 1px solid {$theme.border}; color: {$theme.fgMuted};
                          font-size: 10px;
                        "
                        title="Send issue to an agent in a managed workspace"
                        on:click|stopPropagation={() =>
                          handleSendToAgent(issue)}>Send to Agent</span
                      >
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          <!-- PRs column -->
          <div>
            <div
              style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;"
            >
              <h2
                style="font-size: 13px; font-weight: 600; margin: 0; color: {$theme.fgMuted};"
              >
                Pull Requests
                {#if prs.length > 0}<span
                    style="font-weight: 400; color: {$theme.fgDim};"
                  >
                    ({prs.length})</span
                  >{/if}
              </h2>
            </div>

            {#if prsLoading && prs.length === 0}
              <div
                style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0;"
              >
                Loading...
              </div>
            {:else if prsError}
              <div
                style="padding: 6px 10px; font-size: 11px; color: {$theme.danger}; background: rgba(255,0,0,0.05); border-radius: 4px;"
              >
                {prsError}
              </div>
            {:else if prs.length === 0}
              <div
                style="color: {$theme.fgDim}; font-size: 12px; padding: 8px 0;"
              >
                No open PRs
              </div>
            {:else}
              <div style="display: flex; flex-direction: column; gap: 4px;">
                {#each prs as pr (pr.number)}
                  <button
                    class="gh-card"
                    style="
                      width: 100%; background: {$theme.bgSurface}; border: 1px solid {$theme.border};
                      border-radius: 6px; padding: 8px 12px; cursor: pointer; text-align: left;
                      display: flex; flex-direction: column; gap: 3px; color: {$theme.fg};
                    "
                    on:click={() => openUrl(pr.url)}
                  >
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span
                        style="font-size: 10px; color: {pr.isDraft
                          ? $theme.fgDim
                          : $theme.success}; flex-shrink: 0;">#{pr.number}</span
                      >
                      <span
                        style="font-size: 12px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                      >
                        {pr.title}
                      </span>
                      <span
                        style="font-size: 10px; color: {$theme.fgDim}; flex-shrink: 0;"
                        >{relativeTime(pr.updatedAt)}</span
                      >
                    </div>
                    <div
                      style="display: flex; align-items: center; gap: 4px; font-size: 10px;"
                    >
                      <span style="color: {$theme.fgDim};">{pr.author}</span>
                      <span style="color: {$theme.fgDim};">{pr.headRef}</span>
                      {#if pr.isDraft}
                        <span
                          style="padding: 0 5px; border-radius: 8px; background: {$theme.fgDim}20; color: {$theme.fgDim}; border: 1px solid {$theme.fgDim}40;"
                          >draft</span
                        >
                      {/if}
                      {#each pr.labels as label}
                        <span
                          style="padding: 0 5px; border-radius: 8px; background: {$theme.accent}20; color: {$theme.accent}; border: 1px solid {$theme.accent}40;"
                          >{label}</span
                        >
                      {/each}
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    {:else}
      <div style="color: {$theme.fgDim}; padding: 24px;">Project not found</div>
    {/if}
  </div>
</div>

<style>
  .ws-row:hover,
  .gh-card:hover {
    filter: brightness(1.1);
  }
  .breadcrumb-link:hover {
    text-decoration: underline;
  }
  .action-btn:hover {
    background: rgba(255, 255, 255, 0.05) !important;
  }
  .send-to-agent:hover {
    background: rgba(255, 255, 255, 0.08);
  }
</style>
