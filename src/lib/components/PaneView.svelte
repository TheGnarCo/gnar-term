<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import { commandStore } from "../services/command-registry";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import GroupDashboardSettings from "./GroupDashboardSettings.svelte";
  import { dashboardWorkspaceRegistry } from "../services/dashboard-workspace-service";
  import RestoreCommandPrompt from "./RestoreCommandPrompt.svelte";
  import EmptySurface from "./EmptySurface.svelte";
  import type { Component } from "svelte";
  import type { Pane } from "../types";
  import {
    isTerminalSurface,
    isExtensionSurface,
    isPreviewSurface,
  } from "../types";
  import { surfaceTypeStore } from "../services/surface-type-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import { tabDragState } from "../services/tab-drag";
  import { workspaceDragState } from "../services/workspace-drag";

  export let pane: Pane;
  export let workspaceId: string = "";
  export let onSelectSurface: (surfaceId: string) => void;
  export let onCloseSurface: (surfaceId: string) => void;
  export let onNewSurface: () => void;
  export let onSelectSurfaceType: (typeId: string) => void;
  export let onSplitRight: () => void;
  export let onSplitDown: () => void;
  export let onClosePane: () => void;
  export let onFocusPane: () => void;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
  let scrollState: Record<string, boolean> = {};

  $: showJumpToBottom =
    pane.activeSurfaceId != null
      ? (scrollState[pane.activeSurfaceId] ?? false)
      : false;

  function handleJumpToBottom() {
    const active = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (active && isTerminalSurface(active)) {
      active.terminal.scrollToBottom();
    }
  }
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Notification chrome (Option E hybrid) ---
  // Persistent notify-colored border + corner pip while any surface in
  // this pane has hasUnread; one swell animation when an unread first
  // arrives. Cleared when the pane focuses (handleFocus below).
  $: paneHasUnread = pane.surfaces.some((s) => s.hasUnread);

  // When the workspace is a constrained Dashboard (metadata.isDashboard
  // === true), hide the tab bar, split buttons, and new-surface
  // affordances entirely. The single Live Preview surface fills the pane.
  // Dashboard workspaces can't accumulate surfaces — the preview cannot
  // be closed from the UI, so no regen affordance is needed either.
  //
  // For non-Dashboard workspaces tied to a workspace group
  // (metadata.groupId), keep the workspace-groups regen affordance so
  // users can re-spawn a group-dashboard preview surface after closing it.
  $: workspaceMetadata = $workspaces.find((w) => w.id === workspaceId)
    ?.metadata as Record<string, unknown> | undefined;
  $: isDashboardWorkspace = workspaceMetadata?.isDashboard === true;
  // When the dashboard workspace belongs to the core "settings"
  // contribution, PaneView renders the shared GroupDashboardSettings
  // component in place of the surface list. The workspace carries no
  // preview surface — it exists purely as a routing record.
  $: settingsDashboardGroupId =
    isDashboardWorkspace &&
    workspaceMetadata?.dashboardContributionId === "settings" &&
    typeof workspaceMetadata?.groupId === "string"
      ? (workspaceMetadata.groupId as string)
      : null;
  $: dashboardWorkspaceEntry =
    isDashboardWorkspace &&
    typeof workspaceMetadata?.dashboardWorkspaceId === "string"
      ? ($dashboardWorkspaceRegistry.get(
          workspaceMetadata.dashboardWorkspaceId,
        ) ?? null)
      : null;
  $: regenCommandId =
    isDashboardWorkspace &&
    !settingsDashboardGroupId &&
    typeof workspaceMetadata?.groupId === "string"
      ? "workspace-groups:regenerate-active-group-dashboard"
      : undefined;
  $: regenCommand = regenCommandId
    ? $commandStore.find((c) => c.id === regenCommandId)
    : undefined;
  $: regenDashboardTitle = regenCommand?.title ?? "Regenerate Dashboard";
  $: onRegenDashboard = regenCommand
    ? () => void regenCommand.action()
    : undefined;

  $: surfaceSplitZone =
    $tabDragState?.dropTarget?.kind === "surface-split" &&
    $tabDragState.dropTarget.paneId === pane.id
      ? $tabDragState.dropTarget.zone
      : $workspaceDragState?.dropTarget?.kind === "pane-split" &&
          $workspaceDragState.dropTarget.paneId === pane.id
        ? $workspaceDragState.dropTarget.zone
        : null;

  let arriving = false;
  let prevUnread = false;
  let arriveTimer: ReturnType<typeof setTimeout> | null = null;
  $: {
    if (paneHasUnread && !prevUnread) {
      arriving = true;
      if (arriveTimer) clearTimeout(arriveTimer);
      arriveTimer = setTimeout(() => {
        arriving = false;
      }, 1800);
    }
    prevUnread = paneHasUnread;
  }

  function clearUnreadInPane() {
    if (!paneHasUnread) return;
    workspaces.update((wsList) => {
      const ws = wsList.find((w) => w.id === workspaceId);
      if (!ws) return wsList;
      // Walk this pane's surfaces and clear hasUnread + notification text.
      // Touch only this pane — other panes (incl. background ones) keep
      // their unread state until the user lands on them.
      for (const s of pane.surfaces) {
        if (s.hasUnread) {
          s.hasUnread = false;
          s.notification = undefined;
        }
      }
      return [...wsList];
    });
  }

  function handleFocus() {
    onFocusPane();
    clearUnreadInPane();
  }

  function fitActiveTerminal() {
    const active = pane.surfaces.find((s) => s.id === pane.activeSurfaceId);
    if (active && isTerminalSurface(active)) {
      try {
        active.fitAddon.fit();
      } catch (e) {
        console.warn("fitAddon.fit() failed on resize:", e);
      }
    }
  }

  onMount(() => {
    pane.element = paneEl;
    resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(fitActiveTerminal, 50);
    });
    resizeObserver.observe(paneEl);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    if (arriveTimer) clearTimeout(arriveTimer);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={paneEl}
  data-pane-body={pane.id}
  data-unread={paneHasUnread ? "true" : undefined}
  data-arriving={arriving ? "true" : undefined}
  style="
    flex: 1; display: flex; flex-direction: column;
    min-width: 0; min-height: 0;
    position: relative;
    --notify: {$theme.notify};
    --notify-glow: {$theme.notifyGlow};
    border: 1px solid {paneHasUnread ? $theme.notify : $theme.border};
    border-radius: 4px; overflow: hidden;
    {paneHasUnread
    ? `box-shadow: 0 0 0 1px ${$theme.notifyGlow}, 0 0 14px 1px ${$theme.notifyGlow};`
    : ''}
    {arriving ? 'animation: paneNotifySwell 1.8s ease-out 1;' : ''}
  "
  on:mousedown={handleFocus}
>
  {#if !isDashboardWorkspace}
    <TabBar
      {pane}
      {workspaceId}
      {onSelectSurface}
      {onCloseSurface}
      {onNewSurface}
      {onSelectSurfaceType}
      {onSplitRight}
      {onSplitDown}
      {onClosePane}
      {showJumpToBottom}
      onJumpToBottom={handleJumpToBottom}
    />
  {:else if onRegenDashboard}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        display: flex; align-items: center; justify-content: flex-end;
        background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
        height: 28px; padding: 0 4px; flex-shrink: 0;
      "
    >
      <span
        title={regenDashboardTitle}
        style="color: {$theme.fgDim}; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center;"
        on:click|stopPropagation={onRegenDashboard}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M2 7a5 5 0 1 1 1.5 3.5" /><polyline
            points="2 11 2 7 6 7"
          /></svg
        >
      </span>
    </div>
  {/if}

  {#each pane.surfaces.filter((s) => s.id === pane.activeSurfaceId && isTerminalSurface(s)) as activeTerm (activeTerm.id)}
    {#if isTerminalSurface(activeTerm)}
      <RestoreCommandPrompt surface={activeTerm} />
    {/if}
  {/each}

  {#if paneHasUnread}
    <span
      aria-hidden="true"
      title="New activity in this pane"
      style="
        position: absolute;
        top: 6px; right: 6px;
        width: 7px; height: 7px;
        border-radius: 50%;
        background: {$theme.notify};
        box-shadow: 0 0 6px {$theme.notifyGlow};
        pointer-events: none;
        z-index: 5;
      "
    ></span>
  {/if}

  {#if surfaceSplitZone}
    <div
      aria-hidden="true"
      style="
        position: absolute; pointer-events: none; z-index: 100;
        background: {$theme.accent}33; border: 2px solid {$theme.accent};
        {surfaceSplitZone === 'top'
        ? 'top: 28px; left: 0; right: 0; bottom: 50%;'
        : ''}
        {surfaceSplitZone === 'bottom'
        ? 'top: 50%; left: 0; right: 0; bottom: 0;'
        : ''}
        {surfaceSplitZone === 'left'
        ? 'top: 28px; left: 0; bottom: 0; right: 50%;'
        : ''}
        {surfaceSplitZone === 'right'
        ? 'top: 28px; left: 50%; bottom: 0; right: 0;'
        : ''}
      "
    ></div>
  {/if}

  {#if dashboardWorkspaceEntry}
    {@const entryApi = dashboardWorkspaceEntry.source
      ? getExtensionApiById(dashboardWorkspaceEntry.source)
      : null}
    {#if entryApi}
      <ExtensionWrapper
        api={entryApi}
        component={dashboardWorkspaceEntry.component}
        props={{}}
      />
    {:else}
      <svelte:component this={dashboardWorkspaceEntry.component} />
    {/if}
  {:else if settingsDashboardGroupId}
    <!-- Settings dashboard — PaneView renders the shared settings body
         in place of any surface list. The workspace carries no preview
         surface, so no other render branches fire. -->
    <GroupDashboardSettings groupId={settingsDashboardGroupId} />
  {:else}
    {#if pane.surfaces.length === 0}
      <!-- Empty pane view — the user just closed the last surface. Shows
           the same EmptySurface UX the app uses when every workspace has
           been closed, but scoped to this single empty pane. -->
      <EmptySurface />
    {/if}

    {#each pane.surfaces as surface (surface.id)}
      {#if isTerminalSurface(surface)}
        <TerminalSurface
          {surface}
          visible={surface.id === pane.activeSurfaceId}
          cwd={surface.cwd}
          bind:userScrolledUp={scrollState[surface.id]}
        />
      {:else if isExtensionSurface(surface)}
        {#each $surfaceTypeStore.filter((t) => t.id === surface.surfaceTypeId) as typeDef (typeDef.id)}
          {@const surfaceApi = getExtensionApiById(typeDef.source)}
          {#if surfaceApi}
            <ExtensionWrapper
              api={surfaceApi}
              component={typeDef.component}
              props={{
                ...(surface.props ?? {}),
                surface,
                visible: surface.id === pane.activeSurfaceId,
              }}
            />
          {:else}
            <svelte:component
              this={typeDef.component as Component}
              {...surface.props ?? {}}
              {surface}
              visible={surface.id === pane.activeSurfaceId}
            />
          {/if}
        {/each}
      {:else if isPreviewSurface(surface)}
        <PreviewSurface
          {surface}
          visible={surface.id === pane.activeSurfaceId}
        />
      {/if}
    {/each}
  {/if}
</div>

<style>
  @keyframes paneNotifySwell {
    0% {
      box-shadow: 0 0 0 0 var(--notify-glow);
    }
    45% {
      box-shadow:
        0 0 0 2px var(--notify),
        0 0 22px 4px var(--notify);
    }
    100% {
      box-shadow:
        0 0 0 1px var(--notify-glow),
        0 0 14px 1px var(--notify-glow);
    }
  }
</style>
