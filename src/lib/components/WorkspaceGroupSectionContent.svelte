<script lang="ts">
  import { onDestroy, type Component } from "svelte";
  import type { Readable } from "svelte/store";
  import ContainerRow from "./ContainerRow.svelte";
  import PathStatusLine from "./PathStatusLine.svelte";
  import SplitButton from "./SplitButton.svelte";
  import WorkspaceListView from "./WorkspaceListView.svelte";
  import { resolveProjectColor } from "../theme-data";
  import { theme } from "../stores/theme";
  // SplitButton's prop types theme as Readable<Record<string, string>>;
  // the core store is Readable<ThemeDef>, structurally compatible but
  // not assignable without a cast.
  const themeView = theme as unknown as Readable<Record<string, string>>;
  import { workspaces } from "../stores/workspace";
  import { eventBus, type ExtensionEvent } from "../services/event-bus";
  import type { WorkspaceGroupEntry } from "../config";
  import {
    workspaceGroupsStore,
    getWorkspaceGroup,
  } from "../stores/workspace-groups";
  import {
    deleteWorkspaceGroup,
    updateWorkspaceGroup,
    closeGroupDashboardWorkspace,
    groupDashboardPath,
    openGroupDashboard,
    WORKSPACE_GROUP_STATE_CHANGED,
  } from "../services/workspace-group-service";
  import {
    getWorkspaceActions,
    workspaceActionStore,
    type WorkspaceActionContext,
  } from "../services/workspace-action-registry";
  import {
    childRowContributorStore,
    getChildRowsFor,
  } from "../services/child-row-contributor-registry";
  import { getRootRowRenderer } from "../services/root-row-renderer-registry";
  import {
    showInputPrompt,
    showConfirmPrompt,
    contextMenu,
  } from "../stores/ui";
  import { contrastColor } from "../utils/contrast";
  import { getAllSurfaces, isPreviewSurface, type Workspace } from "../types";

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

  // Re-evaluate contributed children when contributors register/unregister.
  $: void $childRowContributorStore;
  $: childRows = group ? getChildRowsFor("workspace-group", group.id) : [];

  $: groupContext = group
    ? ({
        groupId: group.id,
        projectPath: group.path,
        projectName: group.name,
        isGit: group.isGit,
        projectColor: group.color,
      } satisfies WorkspaceActionContext)
    : undefined;

  $: void $workspaceActionStore;
  $: actions = groupContext
    ? getWorkspaceActions().filter((a) => !a.when || a.when(groupContext!))
    : [];

  $: coreAction = actions.find((a) => a.id === "core:new-workspace");
  $: otherActions = actions.filter((a) => a.id !== "core:new-workspace");

  async function handleRenameGroup() {
    if (!group) return;
    const next = await showInputPrompt("Rename workspace group", group.name);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === group.name) return;
    updateWorkspaceGroup(group.id, { name: trimmed });
  }

  async function handleDeleteGroup() {
    if (!group) return;
    await closeGroupDashboardWorkspace(group);
    deleteWorkspaceGroup(group.id);
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
    items.push({ label: "", action: () => {}, separator: true });
    items.push({
      label: "Delete Workspace Group",
      danger: true,
      action: () => {
        void handleDeleteGroup();
      },
    });
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  $: groupHex = group ? resolveProjectColor(group.color, $theme) : "";
  $: headerFg = group ? contrastColor(groupHex) : $theme.fg;
  $: subtitleFg =
    headerFg === "#000" ? "rgba(0, 0, 0, 0.7)" : "rgba(255, 255, 255, 0.8)";

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
  ];

  // Close X on the group container row — destructive; deletes the
  // group entity. Confirms first. Nested workspaces return to the
  // root-level list; they are not closed.
  async function handleClose() {
    if (!group) return;
    const confirmed = await showConfirmPrompt(
      `Delete workspace group "${group.name}"? Workspaces belonging to this group return to the root list; they are not closed.`,
      {
        title: "Delete Workspace Group",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (!confirmed) return;
    void handleDeleteGroup();
  }

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
      foreground={headerFg}
      {onGripMouseDown}
      gripAriaLabel="Drag workspace group to reorder"
      onBannerContextMenu={handleBannerContextMenu}
      onClose={handleClose}
      closeTitle="Delete workspace group"
      {filterIds}
      dashboardHintFor={hintForGroupDashboardHost}
      scopeId={group.id}
      {containerBlockId}
      containerLabel={group.name}
      testId={group.id}
      workspaceListViewComponent={WorkspaceListView}
    >
      <span
        style="
          flex: 1; min-width: 0;
          font-size: 13px; font-weight: 600; color: {headerFg};
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        ">{group.name}</span
      >

      <svelte:fragment slot="banner-end">
        {#if coreAction}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="project-new-chip"
            on:click|stopPropagation
            style="
              flex-shrink: 0; border-radius: 6px; overflow: visible;
              background: {headerFg === '#000'
              ? 'rgba(0, 0, 0, 0.12)'
              : 'rgba(0, 0, 0, 0.22)'};
              --project-btn-fg: {headerFg};
              --project-btn-hover-bg: {headerFg === '#000'
              ? 'rgba(0, 0, 0, 0.22)'
              : 'rgba(0, 0, 0, 0.36)'};
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
</style>
