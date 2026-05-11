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
  import type { RootWorkspace } from "../config";
  import { workspacesStore, getWorkspace } from "../stores/workspace";
  import {
    deleteWorkspace,
    updateWorkspace,
    closeWorkspacesInWorkspace,
    activateWorkspace,
    WORKSPACE_STATE_CHANGED,
    toggleWorkspaceLock,
    recordDashboardDismissal,
    clearDashboardEnable,
    isDashboardContributionEnabled,
  } from "../services/workspace-service";
  import {
    openWorkspaceSettingsTab,
    closeDashboardContributionTab,
  } from "../services/surface-service";
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
    dashboardContributionStore,
    type DashboardContribution,
  } from "../services/dashboard-contribution-registry";
  import DashboardTileIcon from "./DashboardTileIcon.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";
  import RenameableLabel from "./RenameableLabel.svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import GitBranchIcon from "../icons/GitBranchIcon.svelte";
  import WorktreeIcon from "../icons/WorktreeIcon.svelte";
  const tileIconComponents: Record<string, unknown> = {
    "git-branch": WorktreeIcon,
  };
  import BotIcon from "../icons/BotIcon.svelte";
  import type { MenuItem } from "../context-menu-types";
  import {
    contextMenu,
    showConfirmPrompt,
    setBannerCollapsed,
  } from "../stores/ui";
  import { contrastColor } from "../utils/contrast";
  import { agentsStore } from "../services/agent-detection-service";
  import { rootRailBotStatus } from "../services/rail-attention";
  import { attentionStore } from "../services/attention-api";
  import { getAllPanes } from "../types";
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

  let workspace: RootWorkspace | undefined;
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

  // The Root runtime Workspace shares its id with its RootWorkspace
  // entry (ADR-004). It drives the container row's status dot and
  // renders when the row is clicked.
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

  // Rail bot status — collapsed-mode signal for the rail. Scope is
  // intentionally Root + all branches (worktree AND dashboard branches,
  // both live in branchedWorkspaceIds). This is the only bot-status
  // surface in collapsed mode; banner-level workspaceBotStatus above
  // stays root-only by design.
  $: paneIdsByWorkspaceId = (() => {
    if (!workspace) return new Map<string, string[]>();
    const scopeIds = [workspace.id, ...workspace.branchedWorkspaceIds];
    const map = new Map<string, string[]>();
    for (const wsId of scopeIds) {
      const ws = $workspaces.find((w) => w.id === wsId);
      if (!ws || !ws.paneLayout) continue;
      map.set(
        wsId,
        getAllPanes(ws.paneLayout).map((p) => p.id),
      );
    }
    return map;
  })();
  $: railBotStatus = workspace
    ? rootRailBotStatus(
        workspace,
        $agentsStore,
        $attentionStore,
        paneIdsByWorkspaceId,
      )
    : ("none" as const);

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

  // Workspace's dashboards rendered as chips in the children-leading
  // slot. Chip presence is driven by the persisted Settings "enabled"
  // state — closing a dashboard tab does NOT remove its chip; clicking
  // the chip summons (or re-opens) the corresponding tab.
  // Auto-provisioned contributions (currently just Settings) are
  // excluded because they have dedicated UI — the banner-end gear chip
  // opens Settings as a tab inside the workspace via openWorkspaceSettingsTab.
  $: workspaceDashboards = (() => {
    void $workspacesStore;
    const ws = workspace;
    if (!ws) return [] as DashboardContribution[];
    return $dashboardContributionStore.filter(
      (c) => !c.autoProvision && isDashboardContributionEnabled(ws, c.id),
    );
  })();

  $: tileActions = $workspaceActionStore.filter(
    (a) =>
      a.zone === "workspace-tile" &&
      (!a.when || a.when(workspaceContext ?? {})),
  );

  function showDashboardContextMenu(
    x: number,
    y: number,
    contribution: DashboardContribution,
  ): void {
    if (contribution.autoProvision) return;
    const rootId = workspace?.id;
    if (!rootId) return;
    const items: MenuItem[] = [
      {
        label: `Hide ${contribution.label}`,
        action: () => {
          if (contribution.defaultEnabled) {
            recordDashboardDismissal(rootId, contribution.id);
          } else {
            clearDashboardEnable(rootId, contribution.id);
          }
          closeDashboardContributionTab(rootId, contribution.id);
        },
      },
    ];
    contextMenu.set({ x, y, items });
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
    {#snippet tileActionChip(action: (typeof tileActions)[number])}
      {@const IconComp = tileIconComponents[action.icon] ?? GridIcon}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="
          position: relative;
          flex: 0 0 calc((100% - 12px) / 4);
          min-width: calc((100% - 12px) / 4);
          height: 24px;
        "
        on:mouseenter={() => (hoveredTileActionId = action.id)}
        on:mouseleave={() => (hoveredTileActionId = null)}
      >
        <button
          class="dash-btn"
          data-tile-action={action.id}
          aria-label={action.label}
          title={action.label}
          on:click|stopPropagation={() => {
            if (workspace) setBannerCollapsed(workspace.id, false);
            void action.handler(workspaceContext ?? {});
          }}
          style="
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: {$theme.bgSurface ?? 'transparent'};
            border: 1px solid {$theme.border ?? 'transparent'};
          "
        >
          <DashboardTileIcon
            iconComponent={IconComp}
            baseColor={workspaceHex}
            contributionId={undefined}
            workspacePath={undefined}
            isActive={false}
            isHovered={hoveredTileActionId === action.id}
          />
        </button>
      </div>
    {/snippet}
    {#snippet dashboardChip(contribution: DashboardContribution)}
      {@const IconComp = contribution.icon ?? GridIcon}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        style="
          position: relative;
          flex: 0 0 calc((100% - 12px) / 4);
          min-width: calc((100% - 12px) / 4);
          height: 24px;
        "
        on:mouseenter={() => (hoveredDashId = contribution.id)}
        on:mouseleave={() => (hoveredDashId = null)}
      >
        <button
          class="dash-btn"
          data-dashboard-item={contribution.id}
          data-dashboard-contribution={contribution.id}
          aria-label={contribution.label}
          title={contribution.label}
          on:click|stopPropagation={() => {
            if (workspace) void contribution.openAsTab(workspace);
          }}
          on:contextmenu|preventDefault|stopPropagation={(e) =>
            showDashboardContextMenu(e.clientX, e.clientY, contribution)}
          style="
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: {$theme.bgSurface ?? 'transparent'};
            border: 1px solid {$theme.border ?? 'transparent'};
          "
        >
          <DashboardTileIcon
            iconComponent={IconComp}
            baseColor={workspaceHex}
            contributionId={contribution.id}
            workspacePath={workspace?.path}
            isActive={false}
            isHovered={hoveredDashId === contribution.id}
          />
        </button>
      </div>
    {/snippet}
    <SidebarBanner
      color={workspaceHex}
      {onGripMouseDown}
      onBannerContextMenu={handleBannerContextMenu}
      onBannerClick={handleBannerClick}
      filterIds={branchedIds}
      hasActiveChild={hasActiveDescendant}
      {isPrimaryActive}
      {popoverActive}
      botStatus={railBotStatus}
      scopeId={workspace.id}
      {containerBlockId}
      containerLabel={workspace.name}
      testId={workspace.id}
      workspaceListViewComponent={WorkspaceListView}
      dashboardCount={workspaceDashboards.length + tileActions.length}
    >
      <div
        style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;"
      >
        {#if workspaceBotStatus && workspace.spawnedBy != null}
          <!-- BotIcon next to the title is reserved for orchestrator-
               spawned workspaces — for those, the icon doubles as
               provenance ("this row was created by an agent"). For
               every other workspace the rail "hat" carries bot
               status, so painting the icon here too would be
               redundant. -->
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
          <div style="display: flex; align-items: center; gap: 2px;">
            {#if bannerHovered}
              <SidebarChipButton
                variant="settings"
                title="Workspace Settings"
                idleColor={workspaceHex}
                onClick={() => void openWorkspaceSettingsTab(workspace!.id)}
              />
            {/if}
            <SidebarChipButton
              variant="lock"
              title="Unlock Workspace"
              idleColor={workspaceHex}
              onClick={() => void handleUnlockWorkspace()}
            />
          </div>
        {:else if bannerHovered}
          <div style="display: flex; align-items: center; gap: 2px;">
            <SidebarChipButton
              variant="settings"
              title="Workspace Settings"
              idleColor={workspaceHex}
              onClick={() => void openWorkspaceSettingsTab(workspace!.id)}
            />
            <SidebarChipButton
              variant="close"
              title="Delete Workspace"
              idleColor={workspaceHex}
              onClick={() => void handleDeleteWorkspace()}
            />
          </div>
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
        {#if showToggle}
          <button
            class="dash-btn dash-btn-expand"
            on:click|stopPropagation={toggle}
            on:mouseenter={() => (caretHovered = true)}
            on:mouseleave={() => (caretHovered = false)}
            aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
            title={collapsed ? "Expand workspace" : "Collapse workspace"}
            style="background: {$theme.bgSurface ??
              'transparent'}; border: none; gap: 6px;"
          >
            {#if collapsed && branchedIds.size > 0}
              <span
                data-branch-count
                aria-label="{branchedIds.size} branch{branchedIds.size === 1
                  ? ''
                  : 'es'}"
                style="
                  font-size: 11px; font-weight: 600;
                  color: {caretHovered ? workspaceHex : dimIconColor};
                  line-height: 1; pointer-events: none;
                ">{branchedIds.size}</span
              >
            {/if}
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

      <svelte:fragment slot="children-leading">
        {#if tileActions.length > 0 || workspaceDashboards.length > 0}
          <div class="dashboard-chip-grid">
            {#each tileActions as action (action.id)}
              {@render tileActionChip(action)}
            {/each}
            {#each workspaceDashboards as contribution (contribution.id)}
              {@render dashboardChip(contribution)}
            {/each}
          </div>
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
  .dashboard-chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    /* Visible gap above/below the chip strip is 8px on each side.
       Top: chip-grid padding-top (10px) minus the children container's
       margin-top: -2px collapse against the banner border = 8px.
       Bottom: chip-grid padding-bottom (0) plus WorkspaceListView's
       margin-top: 8px = 8px. Keep these in sync if either neighbor
       changes its margin contribution. */
    padding: 10px 8px 0 8px;
  }
  /* Inside the grid the chip button is absolutely positioned to fill
     its fluid wrapper. The class default `width: 28px` would pin it
     to 28px and break the stretch — force auto so left/right insets
     win. */
  .dashboard-chip-grid .dash-btn {
    width: auto;
  }
  .dash-btn {
    flex: 0 0 auto;
    width: 28px;
    height: 24px;
    border-radius: 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: inherit;
    -webkit-app-region: no-drag;
  }
  .dash-btn-expand {
    flex: 0 0 auto;
    width: auto;
    min-width: 28px;
    padding: 0 6px;
  }
  .dash-btn:hover {
    filter: brightness(1.1);
  }
</style>
