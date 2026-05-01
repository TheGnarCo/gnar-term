<script lang="ts">
  import { nestedWorkspaces } from "../stores/workspace";
  import { workspaceGroupsStore } from "../stores/workspace-groups";
  import { getDashboardContribution } from "../services/dashboard-contribution-registry";
  import {
    getDashboardHost,
    deriveDashboardScope,
  } from "../contexts/dashboard-host";
  import { switchWorkspace } from "../services/workspace-service";
  import { resolveGroupColor } from "../theme-data";
  import { theme } from "../stores/theme";
  import DashboardTileIcon from "./DashboardTileIcon.svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import { wsMeta } from "../services/service-helpers";

  const host = getDashboardHost();
  const scope = deriveDashboardScope(host);

  $: groupId = scope.kind === "group" ? scope.groupId : null;

  $: group = groupId
    ? ($workspaceGroupsStore.find((g) => g.id === groupId) ?? null)
    : null;

  $: groupWs = groupId
    ? $nestedWorkspaces.filter((ws) => wsMeta(ws).groupId === groupId)
    : [];

  $: dashboardCards = groupWs.filter((ws) => {
    const md = wsMeta(ws);
    return md.isDashboard === true && md.dashboardContributionId !== "group";
  });

  $: workspaceRows = groupWs.filter((ws) => !wsMeta(ws).isDashboard);

  $: groupColor = group
    ? resolveGroupColor(group.color, $theme)
    : ($theme.accent ?? "#888");

  function navigate(wsId: string): void {
    const idx = $nestedWorkspaces.findIndex((ws) => ws.id === wsId);
    if (idx >= 0) switchWorkspace(idx);
  }

  function getContribInfo(ws: import("../types").NestedWorkspace): {
    icon: unknown;
    label: string;
    groupPath: string | undefined;
  } {
    const md = wsMeta(ws);
    const contribution = md.dashboardContributionId
      ? getDashboardContribution(md.dashboardContributionId)
      : undefined;
    const tileGroupPath = md.groupId
      ? $workspaceGroupsStore.find((g) => g.id === md.groupId)?.path
      : undefined;
    return {
      icon: contribution?.icon ?? GridIcon,
      label: contribution?.label ?? ws.name,
      groupPath: tileGroupPath,
    };
  }

  $: hasContent = dashboardCards.length > 0 || workspaceRows.length > 0;
</script>

{#if groupId && hasContent}
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
              baseColor={groupColor}
              contributionId={wsMeta(ws).dashboardContributionId}
              groupPath={info.groupPath}
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
            <span class="workspace-dot" style="background: {groupColor};"
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
