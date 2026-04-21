<script lang="ts">
  /**
   * PseudoWorkspaceRow — root-row chrome for entries registered via
   * `registerPseudoWorkspace`. Mirrors ContainerRow's solid-banner look
   * so the Global Agentic Dashboard sits visually alongside Workspace
   * Group banners, but with three deliberate differences:
   *
   *   1. No close affordance — pseudo-workspaces are pinned, never
   *      removable through the sidebar UI (spec §5.2 / §6).
   *   2. Banner click activates the pseudo-workspace (sets
   *      `activePseudoWorkspaceId`). ContainerRow's banner is inert.
   *   3. Drag grip reorders pseudo-workspaces among themselves within
   *      their position band (root-top / root-bottom). Reorder payload
   *      rides the same `reorderContext` store so nothing above the
   *      registry has to know about pseudo-workspaces specifically.
   */
  import { theme } from "../stores/theme";
  import { reorderContext } from "../stores/ui";
  import {
    activePseudoWorkspaceId,
    activeWorkspaceIdx,
  } from "../stores/workspace";
  import DragGrip from "./DragGrip.svelte";
  import type { Component } from "svelte";
  import type { PseudoWorkspace } from "../services/pseudo-workspace-registry";
  import { configStore } from "../config";
  import { resolveProjectColor } from "../theme-data";
  import { contrastColor } from "../utils/contrast";

  export let pseudo: PseudoWorkspace;
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  let gripHovered = false;
  let bannerHovered = false;

  // Resolve the pseudo-workspace color from config. Fallback to the
  // theme accent so rows always render with a solid banner regardless
  // of configuration.
  $: configuredSlot = $configStore.pseudoWorkspaceColors?.[pseudo.id];
  $: bannerBackground = resolveProjectColor(configuredSlot ?? "purple", $theme);
  $: bannerForeground = contrastColor(bannerBackground);

  function activate(): void {
    // Pseudo-workspaces are mutually exclusive with real workspaces —
    // clearing `activeWorkspaceIdx` keeps sidebar `isActive` styling on
    // WorkspaceItem rows in sync (the previously-active workspace no
    // longer renders as selected when the Agents row is picked up).
    activeWorkspaceIdx.set(-1);
    activePseudoWorkspaceId.set(pseudo.id);
  }

  function onBannerKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  }

  $: isActive = $activePseudoWorkspaceId === pseudo.id;
</script>

<div
  data-pseudo-workspace-row={pseudo.id}
  data-pseudo-position={pseudo.position}
  data-active={isActive ? "true" : undefined}
  style="display: flex; position: relative;"
>
  {#if onGripMouseDown}
    <div
      on:mouseenter={() => (gripHovered = true)}
      on:mouseleave={() => (gripHovered = false)}
      style="
        flex-shrink: 0; align-self: stretch; display: flex;
        background: {bannerBackground};
      "
      role="presentation"
    >
      <DragGrip
        theme={$theme}
        visible={gripHovered && $reorderContext === null}
        onMouseDown={onGripMouseDown}
        ariaLabel="Drag to reorder"
        railColor={bannerBackground}
        dotColor={bannerForeground}
        railOpacity={1}
        alwaysShowDots={true}
      />
    </div>
  {/if}
  <div style="flex: 1; min-width: 0; margin-right: 8px;">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      data-pseudo-workspace-banner
      role="button"
      tabindex="0"
      aria-label={pseudo.label}
      on:click={activate}
      on:keydown={onBannerKeydown}
      on:mouseenter={() => (bannerHovered = true)}
      on:mouseleave={() => (bannerHovered = false)}
      style="
        position: relative;
        padding: 4px 6px;
        min-height: 40px;
        background: {bannerBackground};
        color: {bannerForeground};
        border-radius: 6px;
        cursor: pointer;
        outline: {isActive ? `1.5px solid ${$theme.fg}` : 'none'};
        outline-offset: -1.5px;
        transition: background 0.15s;
        filter: {bannerHovered && !isActive ? 'brightness(1.1)' : 'none'};
      "
    >
      <div
        style="padding: 0 8px; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 32px; min-width: 0;"
      >
        {#if pseudo.icon}
          <span
            data-pseudo-workspace-icon
            style="display: inline-flex; flex-shrink: 0; width: 18px; height: 18px; align-items: center; justify-content: center; color: {bannerForeground};"
          >
            <svelte:component this={pseudo.icon as Component} />
          </span>
        {/if}
        <span
          data-pseudo-workspace-label
          style="font-weight: 500; font-size: 13px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
        >
          {pseudo.label}
        </span>
      </div>
    </div>
  </div>
</div>
