<script lang="ts">
  import { onDestroy, type Component } from "svelte";
  import ContainerRow from "./ContainerRow.svelte";
  import PathStatusLine from "./PathStatusLine.svelte";
  import WorkspaceListView from "./WorkspaceListView.svelte";
  import { resolveWorkspaceColor } from "../theme-data";
  import { theme } from "../stores/theme";
  import { runCommandById } from "../services/command-registry";
  import {
    nestedWorkspaces,
    activeNestedWorkspaceIdx,
  } from "../stores/workspace";
  import { eventBus, type ExtensionEvent } from "../services/event-bus";
  import type { Workspace } from "../config";
  import { workspacesStore, getWorkspace } from "../stores/workspace-groups";
  import {
    deleteWorkspace,
    updateWorkspace,
    closeNestedWorkspacesInWorkspace,
    groupDashboardPath,
    openWorkspaceDashboard,
    WORKSPACE_GROUP_STATE_CHANGED,
    toggleWorkspaceLock,
    claimWorkspace,
  } from "../services/workspace-group-service";
  import { archiveWorkspace } from "../services/archive-service";
  import { type WorkspaceActionContext } from "../services/workspace-action-registry";
  import {
    childRowContributorStore,
    getChildRowsFor,
  } from "../services/child-row-contributor-registry";
  import { getRootRowRenderer } from "../services/root-row-renderer-registry";
  import {
    switchNestedWorkspace,
    closeNestedWorkspace,
    createNestedWorkspaceFromDef,
  } from "../services/workspace-service";
  import { getDashboardContribution } from "../services/dashboard-contribution-registry";
  import DashboardTileIcon from "./DashboardTileIcon.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";
  import GridIcon from "../icons/GridIcon.svelte";
  import GitBranchIcon from "../icons/GitBranchIcon.svelte";
  import WorktreeIcon from "../icons/WorktreeIcon.svelte";
  import type { MenuItem } from "../context-menu-types";
  import {
    showInputPrompt,
    contextMenu,
    showConfirmPrompt,
  } from "../stores/ui";
  import { contrastColor } from "../utils/contrast";
  import {
    getAllSurfaces,
    isPreviewSurface,
    type NestedWorkspace,
  } from "../types";
  import { agentsStore } from "../services/agent-detection-service";
  import { variantColor } from "../status-colors";
  import { wsMeta } from "../services/service-helpers";

  export let parentWorkspaceId: string;
  /**
   * The namespaced sidebar-block id that hosts this group — forwarded
   * to the ContainerRow's nested WorkspaceListView so workspace-drag
   * ReorderContext publishes the actual block id.
   */
  export let containerBlockId: string = "";
  /**
   * Forwarded from WorkspaceGroupRowBody — the drag grip is owned by
   * ContainerRow in root mode.
   */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /**
   * Group overlay directive, resolved by the parent from the current
   * reorder context. Covers the entire group block (header +
   * nestedWorkspaces) as one zone.
   */
  export let overlay:
    | { kind: "strong"; label: string }
    | { kind: "light" }
    | null = null;

  let group: Workspace | undefined;
  let stateVersion = 0;

  const onGroupStateChanged = () => {
    stateVersion++;
  };
  eventBus.on(
    WORKSPACE_GROUP_STATE_CHANGED,
    onGroupStateChanged as (e: ExtensionEvent) => void,
  );
  onDestroy(() => {
    eventBus.off(
      WORKSPACE_GROUP_STATE_CHANGED,
      onGroupStateChanged as (e: ExtensionEvent) => void,
    );
  });

  // Re-read whenever the groups list, the nestedWorkspaces store, or state
  // version changes. The store subscription covers mutations through
  // setWorkspaces; stateVersion is there for parity with other
  // extension-driven consumers that listen for the event directly.
  $: {
    void $workspacesStore;
    void $nestedWorkspaces;
    void stateVersion;
    group = getWorkspace(parentWorkspaceId);
  }

  $: filterIds = group ? new Set(group.nestedWorkspaceIds) : new Set<string>();

  // The primary workspace drives the container row's status dot. It is
  // excluded from the nested list — clicking the row activates it directly.
  $: primaryWs = group?.primaryNestedWorkspaceId
    ? $nestedWorkspaces.find((w) => w.id === group!.primaryNestedWorkspaceId)
    : undefined;

  // Nested list shows worktree nestedWorkspaces only (excludes primary and dashboards).
  $: nestedIds = group
    ? new Set(
        group.nestedWorkspaceIds.filter((id) => {
          const ws = $nestedWorkspaces.find((w) => w.id === id);
          if (!ws) return false;
          const md = wsMeta(ws);
          return !md.isDashboard && id !== group!.primaryNestedWorkspaceId;
        }),
      )
    : new Set<string>();

  // Most-active bot status across all nestedWorkspaces in this group.
  $: groupAgents = $agentsStore.filter((a) => filterIds.has(a.workspaceId));
  $: groupBotStatus = (() => {
    if (groupAgents.length === 0) return null;
    const running = groupAgents.filter(
      (a) => a.status === "running" || a.status === "active",
    ).length;
    const waiting = groupAgents.filter((a) => a.status === "waiting").length;
    const idle = groupAgents.filter((a) => a.status === "idle").length;
    if (running > 0)
      return { label: `${running} running`, color: variantColor("success") };
    if (waiting > 0)
      return { label: `${waiting} waiting`, color: variantColor("warning") };
    if (idle > 0)
      return { label: `${idle} idle`, color: variantColor("muted") };
    return null;
  })();

  // True when the primary workspace of this group is currently active.
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
    group && $childRowContributorStore
      ? getChildRowsFor("workspace-group", group.id)
      : [];

  $: groupContext = group
    ? ({
        parentWorkspaceId: group.id,
        groupPath: group.path,
        groupName: group.name,
        isGit: group.isGit,
        workspaceColor: group.color,
      } satisfies WorkspaceActionContext)
    : undefined;

  $: isGroupLocked = group?.locked === true;

  async function handleRenameGroup() {
    if (!group) return;
    const next = await showInputPrompt("Rename workspace group", group.name);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === group.name) return;
    updateWorkspace(group.id, { name: trimmed });
  }

  async function handleUnlockGroup() {
    if (!group) return;
    const confirmed = await showConfirmPrompt(
      `Unlock workspace group "${group.name}"?`,
      { title: "Unlock Workspace", confirmLabel: "Unlock" },
    );
    if (!confirmed) return;
    toggleWorkspaceLock(group.id);
  }

  async function handleDeleteGroup() {
    const g = group;
    if (!g) return;
    const nestedCount = $nestedWorkspaces.filter((w) => {
      const md = wsMeta(w);
      return md?.parentWorkspaceId === g.id && !md?.isDashboard;
    }).length;
    const nestedLine =
      nestedCount > 0
        ? ` ${nestedCount} nested workspace${nestedCount === 1 ? "" : "s"} will also be closed.`
        : "";
    const confirmed = await showConfirmPrompt(
      `Delete group "${g.name}"?${nestedLine}`,
      { title: "Delete Workspace", confirmLabel: "Delete", danger: true },
    );
    if (!confirmed) return;
    closeNestedWorkspacesInWorkspace(g.id);
    deleteWorkspace(g.id);
  }

  // Banner left-click: activate the group's primary workspace if it's not
  // already active. If the primary is already active this is a no-op.
  async function handleBannerClick() {
    if (!group || isPrimaryActive) return;
    // Prefer the primary workspace; fall back to the dashboard then first nested.
    if (primaryWs) {
      const idx = $nestedWorkspaces.indexOf(primaryWs);
      if (idx >= 0) {
        switchNestedWorkspace(idx);
        return;
      }
    } else if (group.primaryNestedWorkspaceId) {
      // Primary workspace is missing (was deleted) — recreate it
      const newWsId = await createNestedWorkspaceFromDef({
        name: group.name,
        cwd: group.path,
        metadata: { parentWorkspaceId: group.id },
      });
      if (newWsId) {
        updateWorkspace(group.id, { primaryNestedWorkspaceId: newWsId });
        claimWorkspace(newWsId, "core");
        // Re-fetch the workspace list to get the new workspace
        const newIdx = $nestedWorkspaces.findIndex((w) => w.id === newWsId);
        if (newIdx >= 0) {
          switchNestedWorkspace(newIdx);
        }
        return;
      }
    }
    if (openWorkspaceDashboard(group)) return;
    const nestedIdx = $nestedWorkspaces.findIndex((w) => {
      return wsMeta(w)?.parentWorkspaceId === group!.id;
    });
    if (nestedIdx >= 0) switchNestedWorkspace(nestedIdx);
  }

  function handleBannerContextMenu(e: MouseEvent) {
    if (!group) return;
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      {
        label: "Rename Workspace",
        action: () => {
          void handleRenameGroup();
        },
      },
    ];
    if (group.isGit && groupContext) {
      items.push({
        label: "New Worktree",
        icon: GitBranchIcon as unknown as Component,
        action: () =>
          runCommandById("worktrees:create-workspace", groupContext),
      });
    }
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: isGroupLocked ? "Unlock Workspace" : "Lock Workspace",
      action: () => {
        if (group) toggleWorkspaceLock(group.id);
      },
    });
    items.push({
      label: "Archive Workspace",
      disabled: isGroupLocked,
      action: () => {
        if (group) void archiveWorkspace(group.id);
      },
    });
    items.push({
      label: "Delete Workspace",
      danger: true,
      disabled: isGroupLocked,
      action: () => {
        void handleDeleteGroup();
      },
    });
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  $: workspaceHex = group ? resolveWorkspaceColor(group.color, $theme) : "";
  $: headerFg = group ? contrastColor(workspaceHex) : $theme.fg;
  $: subtitleFg = $theme.fgMuted ?? $theme.fgDim ?? $theme.fg;
  $: dimIconColor = ($theme.fgDim ?? $theme.fgMuted ?? "#888") as string;

  let hoveredDashId: string | null = null;
  let branchChipHovered = false;
  let caretHovered = false;
  let dashboardCloseHovered: string | null = null;

  $: dashboardWorkspaces = (() => {
    const gId = group?.id;
    if (!gId) return [] as Array<{ ws: NestedWorkspace; idx: number }>;
    return $nestedWorkspaces
      .map((ws, idx) => ({ ws, idx }))
      .filter(({ ws }) => {
        const md = wsMeta(ws);
        return md?.isDashboard === true && md?.parentWorkspaceId === gId;
      })
      .sort((a, b) => {
        const aS = wsMeta(a.ws)?.dashboardContributionId === "settings";
        const bS = wsMeta(b.ws)?.dashboardContributionId === "settings";
        if (aS === bS) return 0;
        return aS ? 1 : -1;
      });
  })();

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
  // preview surface pointed at the group's dashboard path gets a
  // dashboard icon.
  function hintForGroupDashboardHost(ws: NestedWorkspace) {
    if (!group) return undefined;
    const path = groupDashboardPath(group.path);
    const hosts = getAllSurfaces(ws).some(
      (s) => isPreviewSurface(s) && s.path === path,
    );
    if (!hosts) return undefined;
    return {
      id: group.id,
      color: workspaceHex,
      onClick: () => {
        if (group) void openWorkspaceDashboard(group);
      },
    };
  }
</script>

{#if group}
  <div
    data-project-section
    data-project-id={group.id}
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
      dashboardHintFor={hintForGroupDashboardHost}
      scopeId={group.id}
      {containerBlockId}
      containerLabel={group.name}
      testId={group.id}
      workspaceListViewComponent={WorkspaceListView}
    >
      <span
        data-container-row-title
        style="
          flex: 1; min-width: 0;
          font-size: 13px; font-weight: 600; color: {isPrimaryActive
          ? $theme.fg
          : ($theme.fgMuted ?? $theme.fg)};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          user-select: none;
          pointer-events: none;
        ">{group.name}</span
      >

      <svelte:fragment slot="banner-end" let:bannerHovered>
        {#if isGroupLocked}
          <SidebarChipButton
            variant="lock"
            title="Unlock Workspace"
            idleColor={workspaceHex}
            onClick={() => void handleUnlockGroup()}
          />
        {:else if bannerHovered}
          <SidebarChipButton
            variant="close"
            title="Delete Workspace"
            idleColor={workspaceHex}
            onClick={() => void handleDeleteGroup()}
          />
        {/if}
      </svelte:fragment>

      <svelte:fragment slot="banner-subtitle" let:collapsed>
        {#if collapsed && groupBotStatus}
          <div
            data-group-bot-status-row
            aria-hidden="true"
            style="padding: 0 8px 4px 0; font-size: 11px; color: {groupBotStatus.color}; display: flex; align-items: center; gap: 4px; overflow: hidden; opacity: 0.85;"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="flex-shrink: 0;"
            >
              <title>Bot active in group</title>
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
            <span
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              >{groupBotStatus.label}</span
            >
          </div>
        {/if}
        <div style="pointer-events: auto;">
          <PathStatusLine
            target={{
              id: group.id,
              path: group.path,
              isGit: group.isGit,
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
            <!-- svelte-ignore a11y_consider_explicit_label -->
            <button
              class="dash-btn"
              data-dashboard-item={entry.ws.id}
              data-dashboard-contribution={contribId}
              data-active={isActive ? "true" : undefined}
              title={entry.ws.name}
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
                groupPath={group?.path}
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
                ">×</button
              >
            {/if}
          </div>
        {/each}
        {#if groupContext && group?.isGit}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button
            class="dash-btn"
            title="New Worktree"
            on:click|stopPropagation={() =>
              runCommandById("worktrees:create-workspace", groupContext)}
            on:mouseenter={() => (branchChipHovered = true)}
            on:mouseleave={() => (branchChipHovered = false)}
            style="background: {$theme.bgSurface ??
              'transparent'}; border: 1px solid {$theme.border ??
              'transparent'};"
          >
            <DashboardTileIcon
              iconComponent={WorktreeIcon}
              baseColor={workspaceHex}
              contributionId={undefined}
              groupPath={undefined}
              isActive={false}
              isHovered={branchChipHovered}
            />
          </button>
        {/if}
        {#if showToggle}
          <!-- svelte-ignore a11y_consider_explicit_label -->
          <button
            class="dash-btn"
            on:click|stopPropagation={toggle}
            on:mouseenter={() => (caretHovered = true)}
            on:mouseleave={() => (caretHovered = false)}
            title={collapsed ? "Expand" : "Collapse"}
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
            data-project-children={group.id}
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
