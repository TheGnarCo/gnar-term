<script lang="ts">
  import { nestedWorkspaces } from "../stores/nested-workspace";
  import { workspacesStore } from "../stores/workspaces";
  import { getDashboardContribution } from "../services/dashboard-contribution-registry";
  import {
    getDashboardHost,
    deriveDashboardScope,
  } from "../contexts/dashboard-host";
  import { switchNestedWorkspace } from "../services/nested-workspace-service";
  import { resolveWorkspaceColor } from "../theme-data";
  import { theme } from "../stores/theme";
  import DashboardTileIcon from "./DashboardTileIcon.svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import { wsMeta } from "../services/service-helpers";

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  $: parentWorkspaceId =
    scope.kind === "workspace" ? scope.parentWorkspaceId : null;

  $: group = parentWorkspaceId
    ? ($workspacesStore.find((g) => g.id === parentWorkspaceId) ?? null)
    : null;

  $: workspaceWs = parentWorkspaceId
    ? $nestedWorkspaces.filter(
        (ws) => wsMeta(ws).parentWorkspaceId === parentWorkspaceId,
      )
    : [];

  $: dashboardCards = workspaceWs.filter((ws) => {
    const md = wsMeta(ws);
    return md.isDashboard === true && md.dashboardContributionId !== "group";
  });

  $: workspaceRows = workspaceWs.filter((ws) => !wsMeta(ws).isDashboard);

  $: workspaceColor = group
    ? resolveWorkspaceColor(group.color, $theme)
    : ($theme.accent ?? "#888");

  function navigate(wsId: string): void {
    const idx = $nestedWorkspaces.findIndex((ws) => ws.id === wsId);
    if (idx >= 0) switchNestedWorkspace(idx);
  }

  function getContribInfo(ws: import("../types").NestedWorkspace): {
    icon: unknown;
    label: string;
    workspacePath: string | undefined;
  } {
    const md = wsMeta(ws);
    const contribution = md.dashboardContributionId
      ? getDashboardContribution(md.dashboardContributionId)
      : undefined;
    const tileWorkspacePath = md.parentWorkspaceId
      ? $workspacesStore.find((g) => g.id === md.parentWorkspaceId)?.path
      : undefined;
    return {
      icon: contribution?.icon ?? GridIcon,
      label: contribution?.label ?? ws.name,
      workspacePath: tileWorkspacePath,
    };
  }

  $: hasContent = dashboardCards.length > 0 || workspaceRows.length > 0;
</script>

{#if parentWorkspaceId && hasContent}
  <div class="nestedWorkspaces-widget" data-nestedWorkspaces-widget>
    {#if dashboardCards.length > 0}
      <div class="dashboard-cards" data-dashboard-cards>
        {#each dashboardCards as ws (ws.id)}
          {@const info = getContribInfo(ws)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="dashboard-card"
            data-dashboard-card
            data-workspace-id={ws.id}
            title={ws.name}
            on:click={() => navigate(ws.id)}
            style="
              background: {$theme.bgSurface ?? 'transparent'};
              color: {$theme.fg};
              border: 1px solid {$theme.border ?? 'transparent'};
            "
          >
            <DashboardTileIcon
              iconComponent={info.icon}
              baseColor={workspaceColor}
              contributionId={wsMeta(ws).dashboardContributionId}
              workspacePath={info.workspacePath}
            />
            <span class="dashboard-card-label">{info.label}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if workspaceRows.length > 0}
      <div class="workspace-rows" data-workspace-rows>
        {#each workspaceRows as ws (ws.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="workspace-row"
            data-workspace-row
            data-ws-name={ws.name}
            on:click={() => navigate(ws.id)}
            style="color: {$theme.fg};"
          >
            <span class="workspace-dot" style="background: {workspaceColor};"
            ></span>
            <span class="workspace-name">{ws.name}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .nestedWorkspaces-widget {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 8px;
  }

  .dashboard-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .dashboard-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: opacity 0.1s;
  }

  .dashboard-card:hover {
    opacity: 0.85;
  }

  .dashboard-card-label {
    font-size: 11px;
    white-space: nowrap;
  }

  .workspace-rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .workspace-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: opacity 0.1s;
  }

  .workspace-row:hover {
    opacity: 0.8;
  }

  .workspace-dot {
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .workspace-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
