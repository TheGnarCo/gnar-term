<script lang="ts">
  import { onDestroy, type Component } from "svelte";
  import type { Readable } from "svelte/store";
  import ContainerRow from "./ContainerRow.svelte";
  import PathStatusLine from "./PathStatusLine.svelte";
  import SplitButton from "./SplitButton.svelte";
  import WorkspaceListView from "./WorkspaceListView.svelte";
  import { resolveGroupColor } from "../theme-data";
  import { theme } from "../stores/theme";
  // SplitButton's prop types theme as Readable<Record<string, string>>;
  // the core store is Readable<ThemeDef>, structurally compatible but
  // not assignable without a cast.
  const themeView = theme as unknown as Readable<Record<string, string>>;
  import { workspaces, activeWorkspaceIdx } from "../stores/workspace";
  import { eventBus, type ExtensionEvent } from "../services/event-bus";
  import type { WorkspaceGroupEntry } from "../config";
  import {
    workspaceGroupsStore,
    getWorkspaceGroup,
  } from "../stores/workspace-groups";
  import {
    deleteWorkspaceGroup,
    updateWorkspaceGroup,
    closeWorkspacesInGroup,
    groupDashboardPath,
    openGroupDashboard,
    WORKSPACE_GROUP_STATE_CHANGED,
  } from "../services/workspace-group-service";
  import { archiveGroup } from "../services/archive-service";
  import {
    workspaceActionStore,
    type WorkspaceActionContext,
  } from "../services/workspace-action-registry";
  import {
    childRowContributorStore,
    getChildRowsFor,
  } from "../services/child-row-contributor-registry";
  import { getRootRowRenderer } from "../services/root-row-renderer-registry";
  import { switchWorkspace } from "../services/workspace-service";
  import {
    dashboardContributionStore,
    canAddContributionToGroup,
    type DashboardContribution,
  } from "../services/dashboard-contribution-registry";
  import { workspaces as workspacesStore } from "../stores/workspace";
  import {
    showInputPrompt,
    contextMenu,
    showConfirmPrompt,
  } from "../stores/ui";
  import { contrastColor } from "../utils/contrast";
  import { getAllSurfaces, isPreviewSurface, type Workspace } from "../types";
  import { agentsStore } from "../services/agent-detection-service";
  import { variantColor } from "../status-colors";

  function wsMeta(ws: {
    metadata?: unknown;
  }): Record<string, unknown> | undefined {
    return ws.metadata as Record<string, unknown> | undefined;
  }

  export let groupId: string;
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
   * workspaces) as one zone.
   */
  export let overlay:
    | { kind: "strong"; label: string }
    | { kind: "light" }
    | null = null;

  let group: WorkspaceGroupEntry | undefined;
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

  // Re-read whenever the groups list, the workspaces store, or state
  // version changes. The store subscription covers mutations through
  // setWorkspaceGroups; stateVersion is there for parity with other
  // extension-driven consumers that listen for the event directly.
  $: {
    void $workspaceGroupsStore;
    void $workspaces;
    void stateVersion;
    group = getWorkspaceGroup(groupId);
  }

  $: filterIds = group ? new Set(group.workspaceIds) : new Set<string>();

  // Most-active bot status across all workspaces in this group.
  // Used by the collapsed banner chip so collapsed groups surface bot presence.
  $: groupAgents = $agentsStore.filter((a) => filterIds.has(a.workspaceId));
  $: groupStatusColor = (() => {
    if (groupAgents.length === 0) return null;
    if (groupAgents.some((a) => a.status === "running"))
      return variantColor("success");
    if (groupAgents.some((a) => a.status === "waiting"))
      return variantColor("warning");
    if (groupAgents.some((a) => a.status === "idle"))
      return variantColor("muted");
    return null;
  })();

  // True when the currently active workspace belongs to this group —
  // checked via `metadata.groupId` so the match covers both the
  // Dashboard workspace and ordinary nested children, regardless of
  // whether `group.workspaceIds` has been rebuilt yet. Drives the
  // group banner's active-border treatment.
  $: hasActiveChild = (() => {
    const activeWs = $workspaces[$activeWorkspaceIdx];
    if (!activeWs || !group) return false;
    return wsMeta(activeWs)?.groupId === group.id;
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
        groupId: group.id,
        groupPath: group.path,
        groupName: group.name,
        isGit: group.isGit,
        groupColor: group.color,
      } satisfies WorkspaceActionContext)
    : undefined;

  // `$workspaceActionStore` must be read inside this statement so the
  // extension-registered actions (e.g. worktree-workspaces' "New Worktree")
  // reach the `+ New` split-button dropdown when extensions activate after
  // the component mounts.
  $: actions = groupContext
    ? $workspaceActionStore.filter((a) => !a.when || a.when(groupContext!))
    : [];

  $: coreAction = actions.find((a) => a.id === "core:new-workspace");
  $: otherActions = actions.filter((a) => a.id !== "core:new-workspace");

  // Dashboard contributions that aren't yet present on this group and
  // haven't hit their per-group cap. Surfaced in the group's banner
  // context menu so users can add e.g. an Agentic Dashboard when the
  // agentic extension is enabled.
  $: addableContributions = (() => {
    const currentGroup = group;
    if (!currentGroup) return [] as DashboardContribution[];
    const ws = $workspacesStore;
    return $dashboardContributionStore.filter((c) => {
      // autoProvision contributions materialize automatically and
      // cannot be removed — they should not appear in the "Add
      // Dashboard" menu. Covers core Overview, core Settings, and
      // Agentic (when the extension is enabled).
      if (c.autoProvision) return false;
      if (c.isAvailableFor && !c.isAvailableFor(currentGroup)) return false;
      const countForGroup = ws.filter((w) => {
        const md = wsMeta(w);
        return (
          md?.isDashboard === true &&
          md?.groupId === currentGroup.id &&
          md?.dashboardContributionId === c.id
        );
      }).length;
      return canAddContributionToGroup(currentGroup, c.id, countForGroup);
    });
  })();

  async function handleAddDashboardContribution(
    contribution: DashboardContribution,
  ): Promise<void> {
    if (!group) return;
    try {
      await contribution.create(group);
    } catch (err) {
      console.error(
        `[workspace-groups] Failed to add dashboard contribution "${contribution.id}":`,
        err,
      );
    }
  }

  async function handleRenameGroup() {
    if (!group) return;
    const next = await showInputPrompt("Rename workspace group", group.name);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === group.name) return;
    updateWorkspaceGroup(group.id, { name: trimmed });
  }

  async function handleDeleteGroup() {
    const g = group;
    if (!g) return;
    const nestedCount = $workspaces.filter((w) => {
      const md = wsMeta(w);
      return md?.groupId === g.id && !md?.isDashboard;
    }).length;
    const nestedLine =
      nestedCount > 0
        ? ` ${nestedCount} nested workspace${nestedCount === 1 ? "" : "s"} will also be closed.`
        : "";
    const confirmed = await showConfirmPrompt(
      `Delete group "${g.name}"?${nestedLine}`,
      { title: "Delete Workspace Group", confirmLabel: "Delete", danger: true },
    );
    if (!confirmed) return;
    closeWorkspacesInGroup(g.id);
    deleteWorkspaceGroup(g.id);
  }

  // Banner left-click: activate the group's Dashboard if one is bound,
  // otherwise activate the group's first nested workspace (resolved by
  // scanning workspace metadata — `group.workspaceIds` is sometimes
  // empty until `reclaimWorkspacesAcrossGroups` rebuilds it). If a
  // nested workspace is already active this is a no-op — the user
  // already has the group "open", so re-selecting would be noise.
  function handleBannerClick() {
    if (!group || hasActiveChild) return;
    if (openGroupDashboard(group)) return;
    const nestedIdx = $workspaces.findIndex((w) => {
      return wsMeta(w)?.groupId === group!.id;
    });
    if (nestedIdx >= 0) switchWorkspace(nestedIdx);
  }

  function handleBannerContextMenu(e: MouseEvent) {
    if (!group) return;
    e.preventDefault();
    e.stopPropagation();
    const items: Array<{
      label: string;
      action: () => void;
      shortcut?: string;
      separator?: boolean;
      danger?: boolean;
    }> = [
      {
        label: "Rename Workspace Group",
        action: () => {
          void handleRenameGroup();
        },
      },
      {
        label: "Open Dashboard",
        action: () => {
          if (group) void openGroupDashboard(group);
        },
      },
    ];
    if (coreAction && groupContext) {
      items.push({
        label: "New Workspace",
        action: () => coreAction!.handler(groupContext!),
      });
    }
    for (const a of otherActions) {
      items.push({
        label: a.label,
        action: () => void a.handler(groupContext!),
      });
    }
    if (addableContributions.length > 0) {
      items.push({ label: "", action: () => {}, separator: true });
      for (const c of addableContributions) {
        items.push({
          label: c.actionLabel,
          action: () => void handleAddDashboardContribution(c),
        });
      }
    }
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: "Archive Group",
      action: () => {
        if (group) void archiveGroup(group.id);
      },
    });
    items.push({
      label: "Delete Workspace Group",
      danger: true,
      action: () => {
        void handleDeleteGroup();
      },
    });
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  $: groupHex = group ? resolveGroupColor(group.color, $theme) : "";
  $: headerFg = group ? contrastColor(groupHex) : $theme.fg;
  $: subtitleFg = $theme.fgMuted ?? $theme.fgDim ?? $theme.fg;

  $: splitDropdownItems = [
    {
      id: "new-workspace",
      label: "New Workspace",
      icon: "plus",
      handler: () => {
        if (coreAction && groupContext) void coreAction.handler(groupContext);
      },
    },
    ...otherActions.map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      handler: () => {
        void a.handler(groupContext!);
      },
    })),
    // Dashboard contributions that haven't hit their per-group cap —
    // e.g. "Add Agentic Dashboard" shows up here when the agentic
    // extension is enabled and the group doesn't already have one.
    // The computed list above (addableContributions) already filters
    // out contributions at cap, so no extra gate is needed.
    ...addableContributions.map((c) => ({
      id: `contrib:${c.id}`,
      label: c.actionLabel,
      handler: () => void handleAddDashboardContribution(c),
    })),
  ];

  // Dashboard-hint for nested workspaces: any workspace hosting a
  // preview surface pointed at the group's dashboard path gets a
  // dashboard icon.
  function hintForGroupDashboardHost(ws: Workspace) {
    if (!group) return undefined;
    const path = groupDashboardPath(group.path);
    const hosts = getAllSurfaces(ws).some(
      (s) => isPreviewSurface(s) && s.path === path,
    );
    if (!hosts) return undefined;
    return {
      id: group.id,
      color: groupHex,
      onClick: () => {
        if (group) void openGroupDashboard(group);
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
      color={groupHex}
      {onGripMouseDown}
      onBannerContextMenu={handleBannerContextMenu}
      onBannerClick={handleBannerClick}
      {filterIds}
      {hasActiveChild}
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
          font-size: 13px; font-weight: 600; color: {$theme.fg};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          user-select: none;
          pointer-events: none;
        ">{group.name}</span
      >

      <svelte:fragment slot="banner-end" let:bannerHovered let:collapsed>
        <div
          style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0;"
        >
          {#if coreAction}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- `+ New` split button. Background uses the group's own
                 color so the chip stays visually tied to the container,
                 and flips to a stronger variant on banner hover so it
                 remains distinct against the banner's hover background. -->
            <span
              class="project-new-chip"
              on:click|stopPropagation
              style="
                flex-shrink: 0; border-radius: 6px; overflow: visible;
                background: {bannerHovered
                ? groupHex
                : `color-mix(in srgb, ${groupHex} 70%, transparent)`};
                --project-btn-fg: {headerFg};
                --project-btn-hover-bg: {groupHex};
                transition: background 0.15s;
              "
            >
              <SplitButton
                label="+ New"
                onMainClick={() => coreAction?.handler(groupContext ?? {})}
                dropdownItems={splitDropdownItems}
                theme={themeView}
              />
            </span>
          {/if}
          {#if collapsed && groupStatusColor}
            <span
              data-group-status-chip
              title="Bot active in this group"
              style="display: inline-flex; align-items: center; padding: 0 3px;"
            >
              <span
                style="width: 7px; height: 7px; border-radius: 50%; background: {groupStatusColor}; box-shadow: 0 0 0 1px color-mix(in srgb, {groupStatusColor} 35%, transparent);"
              ></span>
            </span>
          {/if}
        </div>
      </svelte:fragment>

      <svelte:fragment slot="banner-subtitle">
        <div style="pointer-events: auto;">
          <PathStatusLine
            target={{
              id: group.id,
              path: group.path,
              isGit: group.isGit,
            }}
            fgColor={subtitleFg}
            iconColor={groupHex}
          />
        </div>
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
                  parentColor={groupHex}
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
          ? groupHex
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
  :global(.project-new-chip button) {
    border-color: transparent !important;
    color: var(--project-btn-fg) !important;
  }
  :global(.project-new-chip button:hover) {
    background: var(--project-btn-hover-bg) !important;
  }
  :global(.project-new-chip button[data-dropdown-open]) {
    background: color-mix(
      in srgb,
      var(--project-btn-hover-bg) 80%,
      #000
    ) !important;
  }
</style>
