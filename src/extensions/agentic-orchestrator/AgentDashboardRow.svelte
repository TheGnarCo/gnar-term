<script lang="ts">
  /**
   * AgentDashboardRow — root-row renderer for AgentDashboard entities
   * inside the Workspaces section. Mirrors ProjectRowBody's grip + body
   * structure: a colored rail on the left shares its color with a
   * solid-filled banner on the right, so the two read as one field.
   *
   * Three visual modes:
   *   - Root + no children: grip + solid-color banner, nothing below.
   *   - Root + nested children: grip stretches the full block height
   *     alongside banner + nested workspace list, matching the project
   *     row pattern.
   *   - Project-nested (parentColor set): banner only, with an accent
   *     strip on the right edge so the row still reads as belonging to
   *     this dashboard while the host project's rail paints the left.
   */
  import { getContext, type Component } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    resolveProjectColor,
  } from "../api";
  import {
    openDashboard,
    dashboardScopedAgents,
    getDashboard,
    dashboardsStore,
    renameDashboard,
    deleteDashboard,
  } from "./dashboard-service";

  /**
   * The AgentDashboard's id — passed by core's WorkspaceListBlock when the
   * row is rendered via registerRootRowRenderer. The component looks the
   * dashboard up from the dashboardsStore so it stays in sync with edits.
   */
  export let id: string;
  /**
   * Drag handle — forwarded from core's createDragReorder. Project-nested
   * rows (rendered outside the root list) won't pass this prop and the
   * grip will simply not render.
   */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /**
   * When non-null, the parent project's color. Triggers the nested
   * compositing variant: no outer grip, dashboard color paints a small
   * accent strip on the right instead of owning the full row.
   */
  export let parentColor: string | undefined = undefined;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;
  const reorderCtx = api.reorderContext;
  const workspacesStore = api.workspaces;
  const { DragGrip, WorkspaceListView } = api.getComponents();

  // Subscribe so rename/recolor + add/remove from the store re-renders.
  $: void $dashboardsStore;
  $: dashboard = getDashboard(id);

  // Workspaces that belong to this dashboard render nested underneath via
  // the shared WorkspaceListView. A workspace "belongs" when its metadata
  // carries either:
  //   - parentDashboardId === id   (spawned worktree from a widget), or
  //   - dashboardId === id         (the dashboard's own hosting workspace)
  // The hosting workspace appearing under the banner makes the dashboard an
  // always-on nested entry — no separate root-level row for the dashboard
  // preview surface.
  $: nestedWorkspaceIds = new Set(
    $workspacesStore
      .filter((ws) => {
        const meta = ws.metadata as Record<string, unknown> | undefined;
        return meta?.parentDashboardId === id || meta?.dashboardId === id;
      })
      .map((ws) => ws.id),
  );

  // WorkspaceItem shows a dashboard icon only for workspaces that HOST a
  // dashboard (metadata.dashboardId set). Spawned worktrees (marked with
  // parentDashboardId) get no icon — they're children of the dashboard,
  // not hosts of one. Click focuses the owning dashboard's preview.
  function hintForHostingWorkspace(ws: { metadata?: Record<string, unknown> }) {
    const hostedId = ws.metadata?.dashboardId;
    if (typeof hostedId !== "string") return undefined;
    const d = getDashboard(hostedId);
    if (!d) return undefined;
    const hostedHex = resolveProjectColor(d.color, $theme);
    return {
      id: hostedId,
      color: hostedHex,
      onClick: () => openDashboard(d),
    };
  }

  // Pick a foreground that remains legible on an arbitrary dashboard color.
  // Duplicated locally (matches ProjectSectionContent) to avoid the
  // extensions/core barrier forbidding imports from lib/utils.
  function contrastColor(hex: string): string {
    const clean = hex.replace(/^#/, "");
    if (clean.length !== 6) return "#fff";
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? "#000" : "#fff";
  }

  $: dashboardHex = dashboard
    ? resolveProjectColor(dashboard.color, $theme)
    : $theme.accent;
  $: bannerFg = contrastColor(dashboardHex);
  // Muted contrast foreground for the subtitle row inside the banner.
  $: subtitleFg =
    bannerFg === "#000" ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";

  // Pull agents from the core detection registry via api.agents and
  // compute the per-dashboard slice via the shared scoping helper.
  const agentsStore = api.agents;
  $: scoped = dashboard ? dashboardScopedAgents(dashboard, $agentsStore) : [];
  $: runningCount = scoped.filter((a) => a.status === "running").length;
  $: waitingCount = scoped.filter((a) => a.status === "waiting").length;
  $: dotStatus =
    waitingCount > 0
      ? "waiting"
      : runningCount > 0
        ? "running"
        : scoped.length > 0
          ? "idle"
          : null;
  $: dotColor =
    dotStatus === "running"
      ? "#4ec957"
      : dotStatus === "waiting"
        ? "#e8b73a"
        : dotStatus === "idle"
          ? "#888888"
          : null;
  $: latestEvent =
    scoped[0] && scoped[0].lastStatusChange
      ? `${scoped[0].agentName} ${scoped[0].status}`
      : null;

  let gripHovered = false;

  async function handleRename() {
    if (!dashboard) return;
    const next = await api.showInputPrompt("Rename dashboard", dashboard.name);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === dashboard.name) return;
    await renameDashboard(dashboard.id, trimmed);
  }

  async function handleDelete() {
    if (!dashboard) return;
    await deleteDashboard(dashboard.id);
  }

  function handleContextMenu(e: MouseEvent) {
    if (!dashboard) return;
    e.preventDefault();
    e.stopPropagation();
    api.showContextMenu(e.clientX, e.clientY, [
      {
        label: "Rename Dashboard",
        action: () => {
          void handleRename();
        },
      },
      {
        label: "Open Dashboard",
        action: () => {
          if (dashboard) openDashboard(dashboard);
        },
      },
      { label: "", action: () => {}, separator: true },
      {
        label: "Delete Dashboard",
        danger: true,
        action: () => {
          void handleDelete();
        },
      },
    ]);
  }

  function isIconName(value: string): boolean {
    return /^[a-z][a-z0-9-]*:[a-z0-9-]+$/i.test(value);
  }

  $: iconValue = $theme.dashboardIcon ?? "lucide:layout-dashboard";
  $: showIconAsName = isIconName(iconValue);
</script>

{#if dashboard}
  <div data-dashboard-row-wrapper={dashboard.id}>
    {#if parentColor}
      <!-- Nested-inside-project mode — banner only, no outer rail.
           Right-edge accent strip in the dashboard color so the row
           still reads as belonging to this dashboard. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-dashboard-id={dashboard.id}
        style="
          position: relative;
          margin: 0 8px 0 0;
          border-radius: 0 6px 6px 0;
          overflow: hidden;
          cursor: pointer;
          background: {dashboardHex}; color: {bannerFg};
        "
        on:click={() => openDashboard(dashboard)}
        on:contextmenu={handleContextMenu}
      >
        <div style="padding: 4px 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span
              aria-hidden="true"
              data-dashboard-icon
              style="
                flex-shrink: 0; display: inline-flex; align-items: center;
                justify-content: center; width: 14px; height: 14px;
                color: {bannerFg};
              "
            >
              {#if showIconAsName}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <title>Dashboard</title>
                  <rect x="3" y="3" width="7" height="9" />
                  <rect x="14" y="3" width="7" height="5" />
                  <rect x="14" y="12" width="7" height="9" />
                  <rect x="3" y="16" width="7" height="5" />
                </svg>
              {:else}
                <span style="font-size: 13px; line-height: 1;">{iconValue}</span
                >
              {/if}
            </span>
            <span
              style="
                flex: 1; min-width: 0;
                font-size: 13px; font-weight: 600; color: {bannerFg};
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
              ">{dashboard.name}</span
            >
            {#if dotColor}
              <span
                title={dotStatus ?? ""}
                style="
                  display: inline-flex; align-items: center; gap: 3px;
                  font-size: 10px; color: {bannerFg};
                  background: color-mix(in srgb, {bannerFg} 18%, transparent);
                  padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
                "
              >
                <span
                  style="width: 6px; height: 6px; border-radius: 50%; background: {dotColor};"
                ></span>
                {#if scoped.length > 1}{scoped.length}
                {/if}{dotStatus}
              </span>
            {/if}
          </div>
          {#if latestEvent}
            <div
              data-dashboard-latest
              style="
                padding: 2px 0 0 22px;
                font-size: 11px; color: {subtitleFg};
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
              "
            >
              {latestEvent}
            </div>
          {/if}
        </div>
      </div>
      <!-- Nested worktree workspaces under a project-nested dashboard —
           render the same list the root-mode branch does so the hierarchy
           (project > dashboard > worktree) reads the same at every level. -->
      {#if nestedWorkspaceIds.size > 0}
        <div
          data-dashboard-nested-workspaces={dashboard.id}
          data-nested-count={nestedWorkspaceIds.size}
          style="display: flex; flex-direction: column;"
        >
          {#if WorkspaceListView}
            <svelte:component
              this={WorkspaceListView as Component}
              filterIds={nestedWorkspaceIds}
              accentColor={dashboardHex}
              scopeId={dashboard.id}
              containerBlockId="__workspaces__"
              containerLabel={dashboard.name}
              dashboardHintFor={hintForHostingWorkspace}
            />
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Root mode — grip on the left shares the dashboard color with the
           banner, and when contributed child rows exist the grip + content
           column stretch together so one rail spans the whole block. -->
      <div style="display: flex; position: relative;">
        {#if onGripMouseDown}
          <div
            on:mouseenter={() => (gripHovered = true)}
            on:mouseleave={() => (gripHovered = false)}
            style="
              flex-shrink: 0; align-self: stretch; display: flex;
              background: {dashboardHex};
            "
            role="presentation"
          >
            <svelte:component
              this={DragGrip as Component}
              theme={$theme}
              visible={gripHovered && $reorderCtx === null}
              onMouseDown={onGripMouseDown}
              ariaLabel="Drag dashboard to reorder"
              railColor={dashboardHex}
              dotColor="#000"
              railOpacity={1}
              alwaysShowDots={true}
            />
          </div>
        {/if}
        <!-- Content column — transparent so only the banner + nested rows
             inside carry visible shapes. 8px trailing margin matches
             project + workspace rows. -->
        <div style="flex: 1; min-width: 0; margin-right: 8px;">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            data-dashboard-id={dashboard.id}
            style="
              position: relative;
              padding: 4px 6px;
              background: {dashboardHex}; color: {bannerFg};
              border-radius: 0 6px 6px 0;
              cursor: pointer;
            "
            on:click={() => openDashboard(dashboard)}
            on:contextmenu={handleContextMenu}
          >
            <div
              style="padding-left: 8px; display: flex; flex-direction: column; gap: 2px;"
            >
              <div style="display: flex; align-items: center; gap: 8px;">
                <span
                  aria-hidden="true"
                  data-dashboard-icon
                  style="
                    flex-shrink: 0; display: inline-flex; align-items: center;
                    justify-content: center; width: 14px; height: 14px;
                    color: {bannerFg};
                  "
                >
                  {#if showIconAsName}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <title>Dashboard</title>
                      <rect x="3" y="3" width="7" height="9" />
                      <rect x="14" y="3" width="7" height="5" />
                      <rect x="14" y="12" width="7" height="9" />
                      <rect x="3" y="16" width="7" height="5" />
                    </svg>
                  {:else}
                    <span style="font-size: 13px; line-height: 1;"
                      >{iconValue}</span
                    >
                  {/if}
                </span>
                <span
                  style="
                    flex: 1; min-width: 0;
                    font-size: 13px; font-weight: 600; color: {bannerFg};
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  ">{dashboard.name}</span
                >
                {#if dotColor}
                  <span
                    title={dotStatus ?? ""}
                    style="
                      display: inline-flex; align-items: center; gap: 3px;
                      font-size: 10px; color: {bannerFg};
                      background: color-mix(in srgb, {bannerFg} 18%, transparent);
                      padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
                    "
                  >
                    <span
                      style="width: 6px; height: 6px; border-radius: 50%; background: {dotColor};"
                    ></span>
                    {#if scoped.length > 1}{scoped.length}
                    {/if}{dotStatus}
                  </span>
                {/if}
              </div>
              {#if latestEvent}
                <div
                  data-dashboard-latest
                  style="
                    padding: 0 0 0 22px;
                    font-size: 11px; color: {subtitleFg};
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                  "
                >
                  {latestEvent}
                </div>
              {/if}
            </div>
          </div>

          <!-- Nested worktree workspaces. Spawned from this dashboard
               (TaskSpawner / Issues / MCP), tagged with
               metadata.parentDashboardId === dashboard.id. Rendered
               through the shared WorkspaceListView so they pick up
               accent coloring, drag-reorder, and context-menu behavior
               identical to root-level workspace rows. -->
          {#if nestedWorkspaceIds.size > 0}
            <div
              data-dashboard-nested-workspaces={dashboard.id}
              data-nested-count={nestedWorkspaceIds.size}
              style="display: flex; flex-direction: column;"
            >
              {#if WorkspaceListView}
                <svelte:component
                  this={WorkspaceListView as Component}
                  filterIds={nestedWorkspaceIds}
                  accentColor={dashboardHex}
                  scopeId={dashboard.id}
                  containerBlockId="__workspaces__"
                  containerLabel={dashboard.name}
                  dashboardHintFor={hintForHostingWorkspace}
                  hideStatusBadges={true}
                />
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
