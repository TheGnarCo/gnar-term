<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { sidebarVisible } from "../stores/ui";
  import { workspaces } from "../stores/workspace";
  import { commandStore } from "../services/command-registry";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import WorkspaceDashboardSettings from "./WorkspaceDashboardSettings.svelte";
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
  import { dismissPane, relaunchPane } from "../services/pane-service";
  import {
    closeWorkspace,
    switchWorkspace,
  } from "../services/workspace-runtime-service";
  import CloseIcon from "../icons/CloseIcon.svelte";

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
  export let isActive: boolean = false;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
  let scrollState: Record<string, boolean> = {};
  let previewRefreshKeys: Record<string, number> = {};
  let closeHovered = false;

  function dismissDashboard() {
    const list = $workspaces;
    const idx = list.findIndex((w) => w.id === workspaceId);
    if (idx < 0) return;
    const parentId = list[idx]?.rootWorkspaceId;
    if (parentId) {
      const parentIdx = list.findIndex((w) => w.id === parentId);
      if (parentIdx >= 0) {
        switchWorkspace(parentIdx);
        return;
      }
    }
    closeWorkspace(idx);
  }

  function handleRefreshPreview() {
    const activeId = pane.activeSurfaceId;
    if (!activeId) return;
    previewRefreshKeys = {
      ...previewRefreshKeys,
      [activeId]: (previewRefreshKeys[activeId] ?? 0) + 1,
    };
  }

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
  // For non-Dashboard workspaces tied to a Workspace
  // (rootWorkspaceId), keep the workspace regen affordance
  // so users can re-spawn a workspace-dashboard preview surface after
  // closing it.
  $: workspaceMetadata = $workspaces.find((w) => w.id === workspaceId);
  $: isDashboardWorkspace = workspaceMetadata?.isDashboard === true;
  // When the dashboard workspace belongs to the core "settings"
  // contribution, PaneView renders the shared WorkspaceDashboardSettings
  // component in place of the surface list. The workspace carries no
  // preview surface — it exists purely as a routing record.
  $: settingsDashboardWorkspaceId =
    isDashboardWorkspace &&
    workspaceMetadata?.dashboardContributionId === "settings" &&
    typeof workspaceMetadata?.rootWorkspaceId === "string"
      ? workspaceMetadata.rootWorkspaceId
      : null;
  $: dashboardWorkspaceEntry =
    isDashboardWorkspace &&
    typeof workspaceMetadata?.dashboardContributionId === "string"
      ? ($dashboardWorkspaceRegistry.get(
          workspaceMetadata.dashboardContributionId,
        ) ?? null)
      : null;
  $: regenCommandId =
    isDashboardWorkspace &&
    !settingsDashboardWorkspaceId &&
    typeof workspaceMetadata?.rootWorkspaceId === "string"
      ? "workspaces:regenerate-active-workspace-dashboard"
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
    border-top: 1px solid {paneHasUnread ? $theme.notify : $theme.border};
    border-right: 1px solid {paneHasUnread ? $theme.notify : $theme.border};
    border-bottom: 1px solid {paneHasUnread ? $theme.notify : $theme.border};
    border-left: {$sidebarVisible
    ? `1px solid ${paneHasUnread ? $theme.notify : $theme.border}`
    : 'none'};
    border-radius: {$sidebarVisible ? '4px' : '0 4px 4px 0'}; overflow: hidden;
    {paneHasUnread
    ? `box-shadow: 0 0 0 1px ${$theme.notifyGlow}, 0 0 14px 1px ${$theme.notifyGlow};`
    : ''}
    {arriving ? 'animation: paneNotifySwell 1.8s ease-out 1;' : ''}
    opacity: {isActive ? 1 : 0.35};
    transition: opacity 0.15s ease;
  "
  on:mousedown={handleFocus}
>
  {#if !isDashboardWorkspace}
    <TabBar
      {pane}
      {workspaceId}
      paneIsActive={isActive}
      {onSelectSurface}
      {onCloseSurface}
      {onNewSurface}
      {onSelectSurfaceType}
      {onSplitRight}
      {onSplitDown}
      {onClosePane}
      {showJumpToBottom}
      onJumpToBottom={handleJumpToBottom}
      onRefreshPreview={handleRefreshPreview}
    />
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      style="
        display: flex; align-items: center; justify-content: flex-end;
        gap: 2px;
        background: {$theme.tabBarBg}; border-bottom: 1px solid {$theme.tabBarBorder};
        height: 28px; padding: 0 4px; flex-shrink: 0;
      "
    >
      {#if onRegenDashboard}
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
      {/if}
      <button
        title="Close dashboard"
        aria-label="Close dashboard"
        on:click|stopPropagation={dismissDashboard}
        on:mouseenter={() => (closeHovered = true)}
        on:mouseleave={() => (closeHovered = false)}
        style="
          display: flex; align-items: center; justify-content: center;
          width: 24px; height: 24px;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: {closeHovered ? $theme.danger : $theme.fgDim};
          cursor: pointer;
          padding: 0;
          transition: color 0.1s;
          -webkit-app-region: no-drag;
        "
      >
        <CloseIcon width="10" height="10" />
      </button>
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
        top: 34px; right: 6px;
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
    {@const dashboardHost = workspaceMetadata
      ? { metadata: workspaceMetadata as unknown as Record<string, unknown> }
      : undefined}
    {#if entryApi}
      <ExtensionWrapper
        api={entryApi}
        component={dashboardWorkspaceEntry.component}
        props={{}}
        host={dashboardHost}
      />
    {:else}
      <svelte:component this={dashboardWorkspaceEntry.component} />
    {/if}
  {:else if settingsDashboardWorkspaceId}
    <!-- Settings dashboard — PaneView renders the shared settings body
         in place of any surface list. The workspace carries no preview
         surface, so no other render branches fire. -->
    <WorkspaceDashboardSettings
      rootWorkspaceId={settingsDashboardWorkspaceId}
    />
  {:else}
    {#if pane.exitedSurface && pane.surfaces.length === 0}
      <!-- svelte-ignore a11y_autofocus -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="group"
        aria-label="Shell exited"
        tabindex="0"
        autofocus
        on:keydown={(e) => {
          if (e.key === "Enter" || e.key.toLowerCase() === "r") {
            e.preventDefault();
            void relaunchPane(pane.id);
          } else if (e.key === "Escape" || e.key.toLowerCase() === "d") {
            e.preventDefault();
            dismissPane(pane.id);
          }
        }}
        style="
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 12px;
          color: {$theme.fgMuted}; font-size: 13px;
          outline: none;
        "
      >
        <span>Shell exited (code {pane.exitedSurface.code}).</span>
        <div style="display: flex; gap: 8px;">
          <button
            on:click={() => void relaunchPane(pane.id)}
            style="
              padding: 5px 14px; border-radius: 6px; cursor: pointer;
              background: {$theme.accent ?? $theme.bgHighlight};
              color: {$theme.fg}; border: 1px solid {$theme.border};
              font-size: 12px; font-family: inherit;
            "
          >
            Relaunch
          </button>
          <button
            on:click={() => dismissPane(pane.id)}
            style="
              padding: 5px 14px; border-radius: 6px; cursor: pointer;
              background: transparent; color: {$theme.fgMuted};
              border: 1px solid {$theme.border};
              font-size: 12px; font-family: inherit;
            "
          >
            Dismiss
          </button>
        </div>
        <span style="font-size: 11px; color: {$theme.fgDim};">
          Enter / R to relaunch · Esc / D to dismiss
        </span>
      </div>
    {:else if pane.surfaces.length === 0}
      <!-- Empty pane view — the user just closed the last surface. In
           pane context EmptySurface renders a compact UI (New Terminal +
           Close Pane), not the full workspace launcher. -->
      <EmptySurface context="pane" paneId={pane.id} {onClosePane} />
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
          refreshTrigger={previewRefreshKeys[surface.id] ?? 0}
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
