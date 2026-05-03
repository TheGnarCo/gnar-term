<script lang="ts">
  /**
   * WorkspaceOverviewDashboard — global dashboard listing all umbrella
   * workspaces with their branched nested workspaces indented beneath.
   *
   * Each row shows:
   *   - Workspace name
   *   - Git-dirty indicator (amber dot) when the working tree has changes
   *   - Agent status chips for any running/waiting agents
   *
   * Clicking a row activates that nested workspace.
   */
  import { workspacesStore } from "../stores/workspaces";
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
    activePseudoWorkspaceId,
  } from "../stores/nested-workspace";
  import { theme } from "../stores/theme";
  import { switchNestedWorkspace } from "../services/nested-workspace-service";
  import {
    buildGroups,
    resolveDirtyPath,
  } from "../services/workspace-overview";
  import WorkspaceOverviewRow from "./WorkspaceOverviewRow.svelte";
  import type { NestedWorkspace } from "../types";

  // Reactive grouped structure — recomputes when either store changes.
  $: groups = buildGroups($workspacesStore, $nestedWorkspaces);

  // Precompute lookup: nestedWorkspace.id → flat index in $nestedWorkspaces.
  $: idxById = new Map<string, number>(
    $nestedWorkspaces.map((nw, i) => [nw.id, i]),
  );

  function handleRowClick(nwId: string): void {
    const idx = idxById.get(nwId);
    if (idx !== undefined) switchNestedWorkspace(idx);
  }

  function isActive(nw: NestedWorkspace): boolean {
    if ($activePseudoWorkspaceId !== null) return false;
    const idx = idxById.get(nw.id);
    return idx !== undefined && idx === $activeNestedWorkspaceIdx;
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

    {#each groups as group (group.umbrella?.id ?? "__standalone__")}
      <!-- Section header: umbrella name or "Standalone" fallback -->
      <div
        data-workspace-overview-umbrella={group.umbrella?.id ?? "standalone"}
        style="
          padding: 10px 20px 4px;
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: {$theme.fgMuted};
        "
      >
        {group.umbrella?.name ?? "Standalone"}
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

      {#each group.rows as nw (nw.id)}
        <WorkspaceOverviewRow
          {nw}
          active={isActive(nw)}
          dirtyPath={resolveDirtyPath(nw, group.umbrella)}
          onClick={handleRowClick}
        />
      {/each}
    {/each}
  </div>
</div>
