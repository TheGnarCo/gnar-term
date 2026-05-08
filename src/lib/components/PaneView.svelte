<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { theme } from "../stores/theme";
  import { sidebarVisible } from "../stores/ui";
  import { workspaces } from "../stores/workspace";
  import TabBar from "./TabBar.svelte";
  import TerminalSurface from "./TerminalSurface.svelte";
  import PreviewSurface from "./PreviewSurface.svelte";
  import RestoreCommandPrompt from "./RestoreCommandPrompt.svelte";
  import EmptySurface from "./EmptySurface.svelte";
  import type { Component } from "svelte";
  import type { Pane } from "../types";
  import {
    isTerminalSurface,
    isRegistrySurface,
    isPreviewSurface,
  } from "../types";
  import { surfaceTypeStore } from "../services/surface-type-registry";
  import { getExtensionApiById } from "../services/extension-loader";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import { tabDragState } from "../services/tab-drag";
  import { workspaceDragState } from "../services/workspace-drag";
  import {
    closePane,
    dismissPane,
    relaunchPane,
  } from "../services/pane-service";
  import { closeWorkspace } from "../services/workspace-runtime-service";
  import CloseButton from "./CloseButton.svelte";

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

  // Dashboard workspaces render via the standard surface pipeline — the
  // dashboard component is registered as a hidden surface type and the
  // workspace is spawned with a single dashboard surface as its initial
  // content. Per-workspace dashboards (those with `rootWorkspaceId`) keep
  // their TabBar so users get split / new-surface affordances; top-level
  // global surfaces (gear-button targets like Settings, Claude Settings,
  // Keyboard Shortcuts, the Workspace Dashboard) suppress the TabBar
  // because they're single-purpose surfaces with no add-tab story.
  $: workspace = $workspaces.find((w) => w.id === workspaceId);
  $: isGlobalSurface =
    workspace?.isDashboard === true && workspace.rootWorkspaceId == null;

  function closeGlobalSurface() {
    // Multi-pane global dashboards (e.g. Spacebase browser + a preview
    // split) should retire the active pane only — closing one half of a
    // split must not tear down the other half. The button only collapses
    // the entire workspace when this pane is the sole pane left.
    const ws = $workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    if (ws.paneLayout.type === "split") {
      closePane(pane.id);
      return;
    }
    const idx = $workspaces.findIndex((w) => w.id === workspaceId);
    if (idx >= 0) closeWorkspace(idx);
  }

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
  {#if !isGlobalSurface}
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
      {showJumpToBottom}
      onJumpToBottom={handleJumpToBottom}
      onRefreshPreview={handleRefreshPreview}
    />
  {:else}
    <div
      style="
        position: absolute; top: 6px; right: 8px;
        z-index: 10;
      "
    >
      <CloseButton
        size="container"
        label="Close"
        on:click={closeGlobalSurface}
      />
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
    {:else if isRegistrySurface(surface)}
      <!-- Wrap registry surfaces in a visibility container so inactive
             tabs stay mounted (preserve component state) but invisible.
             Mirrors TerminalSurface / PreviewSurface, where the surface
             itself toggles display via the `visible` prop. -->
      <div
        style="flex: 1; min-width: 0; min-height: 0; display: {surface.id ===
        pane.activeSurfaceId
          ? 'flex'
          : 'none'}; flex-direction: column;"
      >
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
      </div>
    {:else if isPreviewSurface(surface)}
      <PreviewSurface
        {surface}
        visible={surface.id === pane.activeSurfaceId}
        refreshTrigger={previewRefreshKeys[surface.id] ?? 0}
      />
    {/if}
  {/each}
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
