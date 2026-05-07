<script lang="ts">
  /**
   * WorkspaceOverviewDashboard — global dashboard listing every
   * Workspace with its Branches indented beneath.
   *
   * Each row shows:
   *   - Branch name
   *   - Git-dirty indicator (amber dot) when the working tree has changes
   *   - Agent status chips for any running/waiting agents
   *
   * Clicking a row activates that Branch.
   */
  import {
    workspaces,
    activeWorkspaceIdx,
    activePseudoWorkspaceId,
  } from "../stores/workspace";
  import { theme } from "../stores/theme";
  import { switchWorkspace } from "../services/workspace-runtime-service";
  import {
    buildOverviewSections,
    resolveDirtyPath,
  } from "../services/workspace-overview";
  import WorkspaceOverviewRow from "./WorkspaceOverviewRow.svelte";
  import type { Workspace } from "../types";

  $: sections = buildOverviewSections($workspaces);

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

  <!-- Sections -->
  <div style="flex: 1; overflow: auto; padding: 8px 0;">
    {#if sections.length === 0}
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

    {#each sections as section (section.workspace?.id ?? "__standalone__")}
      <!-- Section header: Workspace name or "Standalone" fallback -->
      <div
        data-workspace-overview-workspace={section.workspace?.id ??
          "standalone"}
        style="
          padding: 10px 20px 4px;
          font-size: 11px; font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: {$theme.fgMuted};
        "
      >
        {section.workspace?.name ?? "Standalone"}
      </div>

      {#if section.branches.length === 0}
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

      {#each section.branches as ws (ws.id)}
        <WorkspaceOverviewRow
          {ws}
          active={isActive(ws)}
          dirtyPath={resolveDirtyPath(ws, section.workspace)}
          onClick={handleRowClick}
        />
      {/each}
    {/each}
  </div>
</div>
