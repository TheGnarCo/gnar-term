<script lang="ts">
  import { onDestroy, type Component } from "svelte";
  import SidebarBanner from "./SidebarBanner.svelte";
  import PathStatusLine from "./PathStatusLine.svelte";
  import WorkspaceDiffPrSubtitle from "./WorkspaceDiffPrSubtitle.svelte";
  import WorkspaceListView from "./WorkspaceListView.svelte";
  import { resolveWorkspaceColor } from "../theme-data";
  import { theme } from "../stores/theme";

  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { eventBus, type ExtensionEvent } from "../services/event-bus";
  import type { WorkspaceRecord } from "../config";
  import { workspacesStore, getWorkspace } from "../stores/workspace";
  import {
    deleteWorkspace,
    updateWorkspace,
    closeWorkspacesInWorkspace,
    workspaceDashboardPath,
    openWorkspaceDashboard,
    activateWorkspace,
    WORKSPACE_STATE_CHANGED,
    toggleWorkspaceLock,
  } from "../services/workspace-service";
  import { archiveWorkspace } from "../services/archive-service";
  import {
    type WorkspaceActionContext,
    workspaceActionStore,
  } from "../services/workspace-action-registry";
  import {
    childRowContributorStore,
    getChildRowsFor,
  } from "../services/child-row-contributor-registry";
  import { getRootRowRenderer } from "../services/root-row-renderer-registry";
  import {
    switchWorkspace,
    closeWorkspace,
  } from "../services/workspace-runtime-service";
  import { getDashboardContribution } from "../services/dashboard-contribution-registry";
  import DashboardTileIcon from "./DashboardTileIcon.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";
  import RenameableLabel from "./RenameableLabel.svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import GitBranchIcon from "../icons/GitBranchIcon.svelte";
  const tileIconComponents: Record<string, unknown> = {
    "git-branch": GitBranchIcon,
  };
  import BotIcon from "../icons/BotIcon.svelte";
  import type { MenuItem } from "../context-menu-types";
  import { contextMenu, showConfirmPrompt } from "../stores/ui";
  import { contrastColor } from "../utils/contrast";
  import { getAllSurfaces, isPreviewSurface, type Workspace } from "../types";
  import { agentsStore } from "../services/agent-detection-service";
  import { variantColor } from "../status-colors";
  import { shortcutHintsActive } from "../stores/shortcut-hints";
  import { modLabel } from "../terminal-service";

  export let rootWorkspaceId: string;
  /**
   * The namespaced sidebar-block id that hosts this workspace — forwarded
   * to the SidebarBanner's child WorkspaceListView so workspace-drag
   * ReorderContext publishes the actual block id.
   */
  export let containerBlockId: string = "";
  /**
   * Forwarded from WorkspaceRowBody — the drag grip is owned by
   * SidebarBanner in root mode.
   */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /**
   * Workspace overlay directive, resolved by the parent from the
   * current reorder context. Covers the entire workspace block (header
   * + workspaces) as one zone.
   */
  export let overlay:
    | { kind: "strong"; label: string }
    | { kind: "light" }
    | null = null;
  /** Position among workspace-kind rows only (0-indexed), for Cmd+N shortcut label. */
  export let shortcutIdx: number | undefined = undefined;
  /**
   * True while this row's collapsed-mode popover/banner is open.
   * Forwarded to SidebarBanner → SidebarRail so the rail stays full-width
   * while the popover is shown.
   */
  export let popoverActive: boolean = false;

  let workspace: WorkspaceRecord | undefined;
  let stateVersion = 0;

  const onWorkspaceStateChanged = () => {
    stateVersion++;
  };
  eventBus.on(
    WORKSPACE_STATE_CHANGED,
    onWorkspaceStateChanged as (e: ExtensionEvent) => void,
  );
  onDestroy(() => {
    eventBus.off(
      WORKSPACE_STATE_CHANGED,
      onWorkspaceStateChanged as (e: ExtensionEvent) => void,
    );
  });

  // Re-read whenever the workspaces list, the workspaces store, or state
  // version changes. The store subscription covers mutations through
  // setWorkspaces; stateVersion is there for parity with other
  // extension-driven consumers that listen for the event directly.
  $: {
    void $workspacesStore;
    void $workspaces;
    void stateVersion;
    workspace = getWorkspace(rootWorkspaceId);
  }

  // Banner reflects only the root workspace's own surfaces — branch
  // banners roll up their own status separately. Mixing in branch
  // agents here made a quiet root look "running" because of work
  // happening in a child Workspace.
  $: filterIds = workspace ? new Set([workspace.id]) : new Set<string>();

  // The Root runtime Workspace shares its id with the Record (ADR-004).
  // It drives the container row's status dot and renders when the row
  // is clicked.
  $: primaryWs = workspace
    ? $workspaces.find((w) => w.id === workspace!.id)
    : undefined;

  // Child list shows branched workspaces only (excludes dashboards).
  $: branchedIds = workspace
    ? new Set(
        workspace.branchedWorkspaceIds.filter((id) => {
          const ws = $workspaces.find((w) => w.id === id);
          if (!ws) return false;
          return !ws.isDashboard;
        }),
      )
    : new Set<string>();

  // Most-active bot status across all workspaces in this workspace.
  $: workspaceAgents = $agentsStore.filter((a) => filterIds.has(a.workspaceId));
  $: workspaceBotStatus = (() => {
    if (workspaceAgents.length === 0) return null;
    const running = workspaceAgents.filter(
      (a) => a.status === "running" || a.status === "active",
    ).length;
    const waiting = workspaceAgents.filter(
      (a) => a.status === "waiting",
    ).length;
    const idle = workspaceAgents.filter((a) => a.status === "idle").length;
    if (running > 0)
      return { label: `${running} running`, color: variantColor("success") };
    if (waiting > 0)
      return { label: `${waiting} waiting`, color: variantColor("warning") };
    if (idle > 0)
      return { label: `${idle} idle`, color: variantColor("muted") };
    return null;
  })();

  // True when the primary workspace of this workspace is currently active.
  // Makes the banner border solid only when the primary workspace
  // is selected (not when a child workspace is selected).
  $: isPrimaryActive = (() => {
    if (!primaryWs) return false;
    return $activeWorkspaceIdx === $workspaces.indexOf(primaryWs);
  })();

  // True when ANY workspace inside this banner (the root itself, any
  // branched workspace, or any dashboard child) is the active workspace.
  // Used to keep the collapsed-mode rail at full width while a descendant
  // is active — the rail represents the whole workspace, not just the root.
  $: hasActiveDescendant = (() => {
    if (!workspace) return false;
    const active = $workspaces[$activeWorkspaceIdx];
    if (!active) return false;
    return (
      active.id === workspace.id || active.rootWorkspaceId === workspace.id
    );
  })();

  // Re-evaluate contributed children when contributors register/unregister.
  // The `$childRowContributorStore` reference is what makes this statement
  // reactive — `getChildRowsFor` reads the store via `get()` and wouldn't
  // otherwise pull Svelte into the dependency graph.
  $: childRows =
    workspace && $childRowContributorStore
      ? getChildRowsFor("workspace", workspace.id)
      : [];

  $: workspaceContext = workspace
    ? ({
        rootWorkspaceId: workspace.id,
        workspacePath: workspace.path,
        workspaceName: workspace.name,
        isGit: workspace.isGit,
        workspaceColor: workspace.color,
      } satisfies WorkspaceActionContext)
    : undefined;

  $: isWorkspaceLocked = workspace?.locked === true;

  let titleLabel: RenameableLabel;

  function handleRenameWorkspace(): void {
    void titleLabel?.startRename();
  }

  function commitRename(next: string): void {
    if (!workspace) return;
    updateWorkspace(workspace.id, { name: next });
  }

  async function handleUnlockWorkspace() {
    if (!workspace) return;
    const confirmed = await showConfirmPrompt(
      `Unlock workspace "${workspace.name}"?`,
      { title: "Unlock Workspace", confirmLabel: "Unlock" },
    );
    if (!confirmed) return;
    toggleWorkspaceLock(workspace.id);
  }

  async function handleDeleteWorkspace() {
    const w = workspace;
    if (!w) return;
    const branchedCount = $workspaces.filter(
      (nw) => nw.rootWorkspaceId === w.id && !nw.isDashboard,
    ).length;
    const branchedLine =
      branchedCount > 0
        ? ` ${branchedCount} branch${branchedCount === 1 ? "" : "es"} will also be closed.`
        : "";
    const confirmed = await showConfirmPrompt(
      `Delete workspace "${w.name}"?${branchedLine}`,
      { title: "Delete Workspace", confirmLabel: "Delete", danger: true },
    );
    if (!confirmed) return;
    deleteWorkspace(w.id);
    closeWorkspacesInWorkspace(w.id);
  }

  // Banner left-click: activate the Workspace's own terminal tabs (its
  // primary surface). Delegates to activateWorkspace so row-click and
  // ⌘1-9 share one routing rule.
  async function handleBannerClick() {
    if (!workspace || isPrimaryActive) return;
    await activateWorkspace(workspace.id);
  }

  function handleBannerContextMenu(e: MouseEvent) {
    if (!workspace) return;
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        action: handleRenameWorkspace,
      },
    ];
    for (const action of tileActions) {
      items.push({
        label: action.label,
        icon: (tileIconComponents[action.icon] ??
          GitBranchIcon) as unknown as Component,
        action: () => action.handler(workspaceContext ?? {}),
      });
    }
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: isWorkspaceLocked ? "Unlock Workspace" : "Lock Workspace",
      action: () => {
        if (workspace) toggleWorkspaceLock(workspace.id);
      },
    });
    items.push({
      label: "Archive Workspace",
      disabled: isWorkspaceLocked,
      action: () => {
        if (workspace) void archiveWorkspace(workspace.id);
      },
    });
    items.push({
      label: "Delete Workspace",
      danger: true,
      disabled: isWorkspaceLocked,
      action: () => {
        void handleDeleteWorkspace();
      },
    });
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  $: workspaceHex = workspace
    ? resolveWorkspaceColor(workspace.color, $theme)
    : "";
  $: headerFg = workspace ? contrastColor(workspaceHex) : $theme.fg;
  $: subtitleFg = $theme.fgMuted ?? $theme.fgDim ?? $theme.fg;
  $: dimIconColor = ($theme.fgDim ?? $theme.fgMuted ?? "#888") as string;

  let hoveredDashId: string | null = null;
  let hoveredTileActionId: string | null = null;
  let caretHovered = false;

  // Workspace's dashboards split into the Settings chip (always rendered
  // last, just before the expansion toggle) and everything else (rendered
  // first, then the tile actions). Settings is intentionally separated
  // out at the data layer so the template can interleave it after the
  // tile-action group instead of relying on a sort-and-suffix pass.
  $: allDashboards = (() => {
    const wId = workspace?.id;
    if (!wId) return [] as Array<{ ws: Workspace; idx: number }>;
    return $workspaces
      .map((ws, idx) => ({ ws, idx }))
      .filter(
        ({ ws }) => ws.isDashboard === true && ws.rootWorkspaceId === wId,
      );
  })();
  $: nonSettingsDashboards = allDashboards.filter(
    ({ ws }) => ws.dashboardContributionId !== "settings",
  );
  $: settingsDashboard = allDashboards.find(
    ({ ws }) => ws.dashboardContributionId === "settings",
  );

  $: tileActions = $workspaceActionStore.filter(
    (a) =>
      a.zone === "workspace-tile" &&
      (!a.when || a.when(workspaceContext ?? {})),
  );

  function showDashboardContextMenu(
    x: number,
    y: number,
    globalIdx: number,
  ): void {
    const ws = $workspaces[globalIdx];
    if (!ws) return;
    const contribId = ws.dashboardContributionId;
    if (typeof contribId !== "string") return;
    const contribution = getDashboardContribution(contribId);
    if (!contribution || contribution.autoProvision) return;
    const items: MenuItem[] = [
      {
        label: `Delete ${contribution.label}`,
        danger: true,
        action: async () => {
          const confirmed = await showConfirmPrompt(
            `Delete "${ws.name}"? The backing markdown file stays on disk so you can re-add this dashboard later without losing your edits.`,
            {
              title: `Delete ${contribution.label}`,
              confirmLabel: "Delete",
              cancelLabel: "Cancel",
            },
          );
          if (!confirmed) return;
          closeWorkspace(globalIdx);
        },
      },
    ];
    contextMenu.set({ x, y, items });
  }

  // Dashboard-hint for child workspaces: any workspace hosting a
  // preview surface pointed at the workspace's dashboard path gets a
  // dashboard icon.
  function hintForWorkspaceDashboardHost(ws: Workspace) {
    if (!workspace) return undefined;
    const path = workspaceDashboardPath(workspace.path);
    const hosts = getAllSurfaces(ws).some(
      (s) => isPreviewSurface(s) && s.path === path,
    );
    if (!hosts) return undefined;
    return {
      id: workspace.id,
      color: workspaceHex,
      onClick: () => {
        if (workspace) void openWorkspaceDashboard(workspace);
      },
    };
  }
</script>

{#if workspace}
  <div
    data-workspace-section
    data-workspace-id={workspace.id}
    style="
      font-size: 12px; color: {$theme.fg};
      position: relative;
    "
  >
    <SidebarBanner
      color={workspaceHex}
      {onGripMouseDown}
      onBannerContextMenu={handleBannerContextMenu}
      onBannerClick={handleBannerClick}
      filterIds={branchedIds}
      hasActiveChild={hasActiveDescendant}
      {popoverActive}
      dashboardHintFor={hintForWorkspaceDashboardHost}
      scopeId={workspace.id}
      {containerBlockId}
      containerLabel={workspace.name}
      testId={workspace.id}
      workspaceListViewComponent={WorkspaceListView}
    >
      <div
        style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;"
      >
        {#if workspaceBotStatus}
          <span
            aria-label={workspaceBotStatus.label}
            title={workspaceBotStatus.label}
            style="display: inline-flex; align-items: center; color: {workspaceBotStatus.color}; flex-shrink: 0;"
          >
            <BotIcon size={13} title={workspaceBotStatus.label} />
          </span>
        {/if}
        <RenameableLabel
          bind:this={titleLabel}
          value={workspace.name}
          onCommit={commitRename}
          ariaLabel="Workspace name"
          klass="no-default-outline"
          style="
            min-width: 0;
            font-size: 13px; font-weight: 600; color: {isPrimaryActive
            ? $theme.fg
            : ($theme.fgMuted ?? $theme.fg)};
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            user-select: none;
            pointer-events: none;
            padding: 2px 4px; margin-left: -4px; border-radius: 4px;
          "
        />
      </div>

      <svelte:fragment slot="banner-end" let:bannerHovered>
        {#if isWorkspaceLocked}
          <SidebarChipButton
            variant="lock"
            title="Unlock Workspace"
            idleColor={workspaceHex}
            onClick={() => void handleUnlockWorkspace()}
          />
        {:else if bannerHovered}
          <SidebarChipButton
            variant="close"
            title="Delete Workspace"
            idleColor={workspaceHex}
            onClick={() => void handleDeleteWorkspace()}
          />
        {:else if shortcutIdx !== undefined && shortcutIdx < 9 && $shortcutHintsActive}
          <span
            aria-hidden="true"
            style="
              font-size: 10px; font-weight: 700; padding: 2px 5px;
              border-radius: 4px; background: {workspaceHex};
              color: {headerFg}; white-space: nowrap; pointer-events: none;
            ">{modLabel}{shortcutIdx + 1}</span
          >
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="banner-subtitle">
        <div style="pointer-events: auto;">
          <PathStatusLine
            target={{
              id: workspace.id,
              path: workspace.path,
              isGit: workspace.isGit,
            }}
            fgColor={subtitleFg}
            iconColor={workspaceHex}
          />
        </div>
        {#if primaryWs}
          <div style="pointer-events: auto;">
            <WorkspaceDiffPrSubtitle
              workspaceId={primaryWs.id}
              accentColor={workspaceHex}
            />
          </div>
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="btn-row" let:collapsed let:toggle let:showToggle>
        {#snippet dashboardChip(entry: { ws: Workspace; idx: number })}
          {@const contribId = entry.ws.dashboardContributionId}
          {@const contribution = contribId
            ? getDashboardContribution(contribId)
            : undefined}
          {@const IconComp = contribution?.icon ?? GridIcon}
          {@const isActive = entry.idx === $activeWorkspaceIdx}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            style="
              position: relative;
              flex: 1 1 calc(25% - 3px);
              min-width: 28px;
              height: 24px;
            "
            on:mouseenter={() => (hoveredDashId = entry.ws.id)}
            on:mouseleave={() => (hoveredDashId = null)}
          >
            <button
              class="dash-btn"
              data-dashboard-item={entry.ws.id}
              data-dashboard-contribution={contribId}
              data-active={isActive ? "true" : undefined}
              aria-label={entry.ws.name}
              on:click|stopPropagation={() => switchWorkspace(entry.idx)}
              on:contextmenu|preventDefault|stopPropagation={(e) =>
                showDashboardContextMenu(e.clientX, e.clientY, entry.idx)}
              style="
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background: {$theme.bgSurface ?? 'transparent'};
                border: 1px solid {$theme.border ?? 'transparent'};
                {isActive ? `box-shadow: 0 0 0 1.5px ${workspaceHex};` : ''}
              "
            >
              <DashboardTileIcon
                iconComponent={IconComp}
                baseColor={workspaceHex}
                contributionId={contribId}
                workspacePath={workspace?.path}
                {isActive}
                isHovered={hoveredDashId === entry.ws.id}
              />
            </button>
          </div>
        {/snippet}

        {#each nonSettingsDashboards as entry (entry.ws.id)}
          {@render dashboardChip(entry)}
        {/each}
        {#each tileActions as action (action.id)}
          <button
            class="dash-btn"
            aria-label={action.label}
            on:click|stopPropagation={() =>
              action.handler(workspaceContext ?? {})}
            on:mouseenter={() => (hoveredTileActionId = action.id)}
            on:mouseleave={() => (hoveredTileActionId = null)}
            style="background: {$theme.bgSurface ??
              'transparent'}; border: 1px solid {$theme.border ??
              'transparent'};"
          >
            <DashboardTileIcon
              iconComponent={tileIconComponents[action.icon] ?? GridIcon}
              baseColor={workspaceHex}
              contributionId={undefined}
              workspacePath={undefined}
              isActive={false}
              isHovered={hoveredTileActionId === action.id}
            />
          </button>
        {/each}
        {#if settingsDashboard}
          {@render dashboardChip(settingsDashboard)}
        {/if}
        {#if showToggle}
          <button
            class="dash-btn"
            on:click|stopPropagation={toggle}
            on:mouseenter={() => (caretHovered = true)}
            on:mouseleave={() => (caretHovered = false)}
            aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
            style="background: {$theme.bgSurface ??
              'transparent'}; border: 1px solid {$theme.border ??
              'transparent'};"
          >
            <svg
              width="12"
              height="8"
              viewBox="0 0 12 8"
              fill="none"
              stroke={caretHovered ? workspaceHex : dimIconColor}
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="transition: transform 0.2s ease; transform: rotate({collapsed
                ? 180
                : 0}deg);"
            >
              <polyline points="1,1 6,7 11,1" />
            </svg>
          </button>
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="after-children">
        {#if childRows.length > 0}
          <div
            data-workspace-children={workspace.id}
            style="display: flex; flex-direction: column;"
          >
            {#each childRows as row (row.kind + ":" + row.id)}
              {@const renderer = getRootRowRenderer(row.kind)}
              {#if renderer}
                <svelte:component
                  this={renderer.component as Component}
                  id={row.id}
                  parentColor={workspaceHex}
                />
              {/if}
            {/each}
          </div>
        {/if}
      </svelte:fragment>
    </SidebarBanner>

    {#if overlay}
      <div
        style="
          position: absolute; top: 0; right: 0; bottom: 0; left: -10px;
          background: {overlay.kind === 'strong'
          ? workspaceHex
          : 'rgba(0, 0, 0, 0.4)'};
          pointer-events: none;
          display: flex; align-items: center; justify-content: center;
          z-index: 2;
        "
      >
        {#if overlay.kind === "strong"}
          <span style="color: {headerFg}; font-size: 13px; font-weight: 600;"
            >{overlay.label}</span
          >
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dash-btn {
    flex: 1 1 calc(25% - 3px);
    min-width: 28px;
    height: 24px;
    border-radius: 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: inherit;
    -webkit-app-region: no-drag;
  }
  .dash-btn:hover {
    filter: brightness(1.1);
  }
</style>
