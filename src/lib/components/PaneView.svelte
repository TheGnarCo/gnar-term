<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { workspaces } from "../stores/workspace";
  import { commandStore } from "../services/command-registry";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import GroupDashboardSettings from "./GroupDashboardSettings.svelte";
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
  export let onReorderTab:
    | ((fromIdx: number, toIdx: number) => void)
    | undefined = undefined;

  let paneEl: HTMLElement;
  let resizeObserver: ResizeObserver;
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
  // A Group Dashboard workspace is a Dashboard workspace (metadata.isDashboard)
  // that belongs to a Workspace Group (metadata.groupId). Group Dashboards
  // get an Overview/Settings tab strip over the single preview surface —
  // Settings lets the user edit the group's name + banner color without
  // reaching for the sidebar context menu. Global Agentic Dashboard already
  // has its own Settings via GlobalAgenticDashboardBody, so we scope this
  // path to real (group-backed) dashboard workspaces only.
  $: groupDashboardId =
    isDashboardWorkspace && typeof workspaceMetadata?.groupId === "string"
      ? (workspaceMetadata.groupId as string)
      : null;
  let groupDashboardTab: "overview" | "settings" = "overview";
  $: regenCommandId =
    !isDashboardWorkspace && typeof workspaceMetadata?.groupId === "string"
      ? "workspace-groups:regenerate-active-group-dashboard"
      : undefined;
  $: regenCommand = regenCommandId
    ? $commandStore.find((c) => c.id === regenCommandId)
    : undefined;
  $: regenDashboardTitle = regenCommand?.title ?? "Regenerate Dashboard";
  $: onRegenDashboard = regenCommand
    ? () => void regenCommand.action()
    : undefined;

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
      {onReorderTab}
      {onRegenDashboard}
      {regenDashboardTitle}
    />
  {:else if groupDashboardId}
    <div
      data-group-dashboard-tabs
      style="
        flex-shrink: 0;
        display: flex; align-items: stretch; gap: 4px;
        padding: 0 12px; border-bottom: 1px solid {$theme.border};
        background: {$theme.bgSurface};
      "
    >
      {#each [{ id: "overview" as const, label: "Overview" }, { id: "settings" as const, label: "Settings" }] as tab (tab.id)}
        {@const isActive = groupDashboardTab === tab.id}
        <button
          data-group-dashboard-tab={tab.id}
          data-active={isActive ? "true" : undefined}
          on:click={() => (groupDashboardTab = tab.id)}
          style="
            padding: 8px 16px;
            background: transparent;
            color: {isActive ? $theme.fg : $theme.fgDim};
            border: none;
            border-bottom: 2px solid {isActive ? $theme.accent : 'transparent'};
            font-size: 13px; font-weight: {isActive ? 600 : 500};
            cursor: pointer;
          "
        >
          {tab.label}
        </button>
      {/each}
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
        visible={surface.id === pane.activeSurfaceId &&
          (!groupDashboardId || groupDashboardTab === "overview")}
      />
    {/if}
  {/each}

  {#if groupDashboardId && groupDashboardTab === "settings"}
    <GroupDashboardSettings groupId={groupDashboardId} />
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
