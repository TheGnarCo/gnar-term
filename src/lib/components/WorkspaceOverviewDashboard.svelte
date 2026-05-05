<script lang="ts">
  /**
   * WorkspaceOverviewDashboard — global dashboard listing all parent
   * workspaces with their branched child workspaces indented beneath.
   *
   * Each row shows:
   *   - Workspace name
   *   - Git-dirty indicator (amber dot) when the working tree has changes
   *   - Agent status chips for any running/waiting agents
   *
   * Clicking a row activates that child workspace.
   */
  import {
    workspaces,
    activeWorkspaceIdx,
    activePseudoWorkspaceId,
  } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import { switchWorkspace } from "../services/workspace-runtime-service";
  import {
    buildGroups,
    resolveDirtyPath,
  } from "../services/workspace-overview";
  import WorkspaceOverviewRow from "./WorkspaceOverviewRow.svelte";
  import type { Workspace } from "../types";

  // Reactive grouped structure — recomputes when unified workspaces store changes.
  $: groups = buildGroups($workspaces);

  // Precompute lookup: workspace.id → flat index in $workspaces (for switching).
  $: idxById = new Map<string, number>($workspaces.map((nw, i) => [nw.id, i]));

  function handleRowClick(wsId: string): void {
    const idx = idxById.get(wsId);
    if (idx !== undefined) switchWorkspace(idx);
  }

  function isActive(ws: Workspace): boolean {
    if ($activePseudoWorkspaceId !== null) return false;
    const idx = idxById.get(ws.id);
    return idx !== undefined && idx === $activeWorkspaceIdx;
  }
</script>

<div
  data-workspace-overview-dashboard
  style="
    flex: 1; min-width: 0; min-height: 0;
    display: flex; flex-direction: column;
    background: {$theme.bg}; color: {$theme.fg};
    overflow: auto;
  "
>
  <!-- Header -->
  <div
    style="
      flex-shrink: 0;
      padding: 16px 20px 12px;
      border-bottom: 1px solid {$theme.border};
      background: {$theme.bgSurface};
    "
  >
    <h2
      style="
        margin: 0;
        font-size: 15px; font-weight: 600;
        color: {$theme.fg};
      "
    >
      Workspaces
    </h2>
    <p style="margin: 4px 0 0; font-size: 12px; color: {$theme.fgDim};">
      All workspaces — click any row to navigate
    </p>
  </div>

  <!-- Groups -->
  <div style="flex: 1; overflow: auto; padding: 8px 0;">
    {#if groups.length === 0}
      <div
        data-workspace-overview-empty
        style="
          padding: 24px 20px;
          font-size: 13px; color: {$theme.fgDim};
        "
      >
        No workspaces yet.
      </div>
    {/if}

    {#each groups as group (group.workspace?.id ?? "__standalone__")}
      <!-- Section header: workspace name or "Standalone" fallback -->
      <div
        data-workspace-overview-workspace={group.workspace?.id ?? "standalone"}
        style="
          padding: 10px 20px 4px;
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: {$theme.fgMuted};
        "
      >
        {group.workspace?.name ?? "Standalone"}
      </div>

      {#if group.rows.length === 0}
        <div
          style="
            padding: 4px 20px 8px;
            font-size: 12px; color: {$theme.fgDim};
            font-style: italic;
          "
        >
          No branches
        </div>
      {/if}

      {#each group.rows as ws (ws.id)}
        <WorkspaceOverviewRow
          {ws}
          active={isActive(ws)}
          dirtyPath={resolveDirtyPath(ws, group.workspace)}
          onClick={handleRowClick}
        />
      {/each}
    {/each}
  </div>
</div>
