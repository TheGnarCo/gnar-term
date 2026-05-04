<script lang="ts">
  import { onDestroy, type Component } from "svelte";
  import ContainerRow from "./ContainerRow.svelte";
  import PathStatusLine from "./PathStatusLine.svelte";
  import WorkspaceListView from "./WorkspaceListView.svelte";
  import { resolveWorkspaceColor } from "../theme-data";
  import { theme } from "../stores/theme";

  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
  } from "../stores/nested-workspace";
  import { eventBus, type ExtensionEvent } from "../services/event-bus";
  import type { Workspace } from "../config";
  import { workspacesStore, getWorkspace } from "../stores/workspaces";
  import {
    deleteWorkspace,
    updateWorkspace,
    closeNestedWorkspacesInWorkspace,
    workspaceDashboardPath,
    openWorkspaceDashboard,
    WORKSPACE_STATE_CHANGED,
    toggleWorkspaceLock,
    claimWorkspace,
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
    switchNestedWorkspace,
    closeNestedWorkspace,
    createNestedWorkspaceFromDef,
  } from "../services/nested-workspace-service";
  import { getDashboardContribution } from "../services/dashboard-contribution-registry";
  import DashboardTileIcon from "./DashboardTileIcon.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";
  import RenameableLabel from "./RenameableLabel.svelte";
  import SidebarSubtitleRow from "./SidebarSubtitleRow.svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import GitBranchIcon from "../icons/GitBranchIcon.svelte";
  import CloseIcon from "../icons/CloseIcon.svelte";
  const tileIconComponents: Record<string, unknown> = {
    "git-branch": GitBranchIcon,
  };
  import BotIcon from "../icons/BotIcon.svelte";
  import type { MenuItem } from "../context-menu-types";
  import { contextMenu, showConfirmPrompt } from "../stores/ui";
  import { contrastColor } from "../utils/contrast";
  import {
    getAllSurfaces,
    isPreviewSurface,
    type NestedWorkspace,
  } from "../types";
  import { agentsStore } from "../services/agent-detection-service";
  import { variantColor } from "../status-colors";
  import { wsMeta } from "../services/service-helpers";
  import { shortcutHintsActive } from "../stores/shortcut-hints";
  import { modLabel } from "../terminal-service";

  export let parentWorkspaceId: string;
  /**
   * The namespaced sidebar-block id that hosts this workspace — forwarded
   * to the ContainerRow's nested WorkspaceListView so workspace-drag
   * ReorderContext publishes the actual block id.
   */
  export let containerBlockId: string = "";
  /**
   * Forwarded from WorkspaceRowBody — the drag grip is owned by
   * ContainerRow in root mode.
   */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /**
   * Workspace overlay directive, resolved by the parent from the
   * current reorder context. Covers the entire workspace block (header
   * + nestedWorkspaces) as one zone.
   */
  export let overlay:
    | { kind: "strong"; label: string }
    | { kind: "light" }
    | null = null;
  /** Position among workspace-kind rows only (0-indexed), for Cmd+N shortcut label. */
  export let shortcutIdx: number | undefined = undefined;

  let workspace: Workspace | undefined;
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

  // Re-read whenever the workspaces list, the nestedWorkspaces store, or state
  // version changes. The store subscription covers mutations through
  // setWorkspaces; stateVersion is there for parity with other
  // extension-driven consumers that listen for the event directly.
  $: {
    void $workspacesStore;
    void $nestedWorkspaces;
    void stateVersion;
    workspace = getWorkspace(parentWorkspaceId);
  }

  $: filterIds = workspace
    ? new Set(workspace.nestedWorkspaceIds)
    : new Set<string>();

  // The primary workspace drives the container row's status dot. It is
  // excluded from the nested list — clicking the row activates it directly.
  $: primaryWs = workspace?.primaryNestedWorkspaceId
    ? $nestedWorkspaces.find(
        (w) => w.id === workspace!.primaryNestedWorkspaceId,
      )
    : undefined;

  // Nested list shows worktree nestedWorkspaces only (excludes primary and dashboards).
  $: nestedIds = workspace
    ? new Set(
        workspace.nestedWorkspaceIds.filter((id) => {
          const ws = $nestedWorkspaces.find((w) => w.id === id);
          if (!ws) return false;
          const md = wsMeta(ws);
          return !md.isDashboard && id !== workspace!.primaryNestedWorkspaceId;
        }),
      )
    : new Set<string>();

  // Most-active bot status across all nestedWorkspaces in this workspace.
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
  // Makes the container row border solid only when the primary workspace
  // is selected (not when a nested workspace is selected).
  $: isPrimaryActive = (() => {
    if (!primaryWs) return false;
    return $activeNestedWorkspaceIdx === $nestedWorkspaces.indexOf(primaryWs);
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
        parentWorkspaceId: workspace.id,
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
    const nestedCount = $nestedWorkspaces.filter((nw) => {
      const md = wsMeta(nw);
      return md?.parentWorkspaceId === w.id && !md?.isDashboard;
    }).length;
    const nestedLine =
      nestedCount > 0
        ? ` ${nestedCount} branch${nestedCount === 1 ? "" : "es"} will also be closed.`
        : "";
    const confirmed = await showConfirmPrompt(
      `Delete workspace "${w.name}"?${nestedLine}`,
      { title: "Delete Workspace", confirmLabel: "Delete", danger: true },
    );
    if (!confirmed) return;
    // Delete the umbrella BEFORE cascading the close. Closing a nested
    // workspace fires `workspace:closed`, and `setupPrimaryWorkspaceAutoRecreation`
    // looks the umbrella up by `primaryNestedWorkspaceId` to recreate a
    // replacement primary. If the umbrella is still in the store at that
    // point, the listener spawns a phantom nested workspace whose
    // parentWorkspaceId then dangles when we delete the umbrella next —
    // on reload the orphan gets re-wrapped into a fresh umbrella, so
    // deletes appear to "come back".
    deleteWorkspace(w.id);
    closeNestedWorkspacesInWorkspace(w.id);
  }

  // Banner left-click: activate the workspace's last-active (or primary) branch
  // if it's not already active. If already active this is a no-op.
  async function handleBannerClick() {
    if (!workspace || isPrimaryActive) return;
    // Prefer lastActiveNestedWorkspaceId, fall back to primaryNestedWorkspaceId.
    const preferredId =
      workspace.lastActiveNestedWorkspaceId ??
      workspace.primaryNestedWorkspaceId;
    const preferredWs = $nestedWorkspaces.find((w) => w.id === preferredId);
    if (preferredWs) {
      const idx = $nestedWorkspaces.indexOf(preferredWs);
      if (idx >= 0) {
        switchNestedWorkspace(idx);
        return;
      }
    } else if (workspace.primaryNestedWorkspaceId) {
      // Primary workspace is specifically set but missing (was deleted) — recreate it.
      const primaryExists = $nestedWorkspaces.some(
        (w) => w.id === workspace!.primaryNestedWorkspaceId,
      );
      if (!primaryExists) {
        const newWsId = await createNestedWorkspaceFromDef({
          name: workspace.name,
          cwd: workspace.path,
          metadata: { parentWorkspaceId: workspace.id },
        });
        if (newWsId) {
          updateWorkspace(workspace.id, { primaryNestedWorkspaceId: newWsId });
          claimWorkspace(newWsId, "core");
          // Re-fetch the workspace list to get the new workspace
          const newIdx = $nestedWorkspaces.findIndex((w) => w.id === newWsId);
          if (newIdx >= 0) {
            switchNestedWorkspace(newIdx);
          }
          return;
        }
      }
    }
    if (openWorkspaceDashboard(workspace)) return;
    const nestedIdx = $nestedWorkspaces.findIndex((w) => {
      return wsMeta(w)?.parentWorkspaceId === workspace!.id;
    });
    if (nestedIdx >= 0) switchNestedWorkspace(nestedIdx);
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
  let dashboardCloseHovered: string | null = null;

  $: dashboardWorkspaces = (() => {
    const wId = workspace?.id;
    if (!wId) return [] as Array<{ ws: NestedWorkspace; idx: number }>;
    return $nestedWorkspaces
      .map((ws, idx) => ({ ws, idx }))
      .filter(({ ws }) => {
        const md = wsMeta(ws);
        return md?.isDashboard === true && md?.parentWorkspaceId === wId;
      })
      .sort((a, b) => {
        const aS = wsMeta(a.ws)?.dashboardContributionId === "settings";
        const bS = wsMeta(b.ws)?.dashboardContributionId === "settings";
        if (aS === bS) return 0;
        return aS ? 1 : -1;
      });
  })();

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
    const ws = $nestedWorkspaces[globalIdx];
    if (!ws) return;
    const md = wsMeta(ws);
    const contribId = md?.dashboardContributionId;
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
          closeNestedWorkspace(globalIdx);
        },
      },
    ];
    contextMenu.set({ x, y, items });
  }

  // Dashboard-hint for nested nestedWorkspaces: any workspace hosting a
  // preview surface pointed at the workspace's dashboard path gets a
  // dashboard icon.
  function hintForWorkspaceDashboardHost(ws: NestedWorkspace) {
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
    <ContainerRow
      color={workspaceHex}
      {onGripMouseDown}
      onBannerContextMenu={handleBannerContextMenu}
      onBannerClick={handleBannerClick}
      filterIds={nestedIds}
      hasActiveChild={isPrimaryActive}
      dashboardHintFor={hintForWorkspaceDashboardHost}
      scopeId={workspace.id}
      {containerBlockId}
      containerLabel={workspace.name}
      testId={workspace.id}
      workspaceListViewComponent={WorkspaceListView}
    >
      <RenameableLabel
        bind:this={titleLabel}
        value={workspace.name}
        onCommit={commitRename}
        ariaLabel="Workspace name"
        klass="no-default-outline"
        style="
          flex: 1; min-width: 0;
          font-size: 13px; font-weight: 600; color: {isPrimaryActive
          ? $theme.fg
          : ($theme.fgMuted ?? $theme.fg)};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          user-select: none;
          pointer-events: none;
          padding: 2px 4px; margin-left: -4px; border-radius: 4px;
        "
      />

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

      <svelte:fragment slot="banner-subtitle" let:collapsed>
        {#if collapsed && workspaceBotStatus}
          <SidebarSubtitleRow
            data-workspace-bot-status-row
            color={workspaceBotStatus.color}
            padding="0 8px 4px 0"
            opacity={0.85}
          >
            <BotIcon size={10} />
            <span
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              >{workspaceBotStatus.label}</span
            >
          </SidebarSubtitleRow>
        {/if}
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
      </svelte:fragment>

      <svelte:fragment slot="btn-row" let:collapsed let:toggle let:showToggle>
        {#each dashboardWorkspaces as entry (entry.ws.id)}
          {@const md = wsMeta(entry.ws)}
          {@const contribId = md.dashboardContributionId}
          {@const contribution = contribId
            ? getDashboardContribution(contribId)
            : undefined}
          {@const IconComp = contribution?.icon ?? GridIcon}
          {@const isActive = entry.idx === $activeNestedWorkspaceIdx}
          {@const canDelete = contribution && !contribution.autoProvision}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            style="
              position: relative;
              flex: 1 1 calc(25% - 3px);
              min-width: 32px;
              height: 30px;
            "
            on:mouseenter={() => (hoveredDashId = entry.ws.id)}
            on:mouseleave={() => {
              hoveredDashId = null;
              dashboardCloseHovered = null;
            }}
          >
            <button
              class="dash-btn"
              data-dashboard-item={entry.ws.id}
              data-dashboard-contribution={contribId}
              data-active={isActive ? "true" : undefined}
              aria-label={entry.ws.name}
              on:click|stopPropagation={() => switchNestedWorkspace(entry.idx)}
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
            {#if canDelete && hoveredDashId === entry.ws.id}
              <button
                title={`Delete ${contribution.label}`}
                aria-label={`Delete ${contribution.label}`}
                on:click|stopPropagation={async () => {
                  const confirmed = await showConfirmPrompt(
                    `Delete "${entry.ws.name}"? The backing markdown file stays on disk so you can re-add this dashboard later without losing your edits.`,
                    {
                      title: `Delete ${contribution.label}`,
                      confirmLabel: "Delete",
                      cancelLabel: "Cancel",
                    },
                  );
                  if (!confirmed) return;
                  closeNestedWorkspace(entry.idx);
                }}
                on:mouseenter={() => (dashboardCloseHovered = entry.ws.id)}
                on:mouseleave={() => (dashboardCloseHovered = null)}
                style="
                  position: absolute;
                  top: 50%; right: 6px;
                  transform: translateY(-50%);
                  display: flex; align-items: center; justify-content: center;
                  width: 14px; height: 14px;
                  color: {dashboardCloseHovered === entry.ws.id
                  ? $theme.danger
                  : $theme.fgDim};
                  background: {$theme.bgSurface ?? $theme.bg};
                  border: 1px solid {dashboardCloseHovered === entry.ws.id
                  ? $theme.danger
                  : $theme.fgDim};
                  border-radius: 3px;
                  cursor: pointer;
                  padding: 0;
                  font-size: 8px; line-height: 1;
                  transition: color 0.1s, border-color 0.1s;
                  -webkit-app-region: no-drag;
                  z-index: 1;
                "><CloseIcon width="8" height="8" /></button
              >
            {/if}
          </div>
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

      <svelte:fragment slot="after-nested">
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
    </ContainerRow>

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
    min-width: 32px;
    height: 30px;
    border-radius: 6px;
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
