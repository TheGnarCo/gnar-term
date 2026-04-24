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
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import { getExtensionApiById } from "../services/extension-loader";
  import type { Component } from "svelte";
  import type { PseudoWorkspace } from "../services/pseudo-workspace-registry";
  import { configStore } from "../config";
  import { resolveGroupColor } from "../theme-data";

  export let pseudo: PseudoWorkspace;
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  // When the pseudo-workspace registers a `rowBody` component, render
  // it via ExtensionWrapper so it receives the registering extension's
  // `api` through context — same pattern SecondarySidebar/WorkspaceItem
  // use for extension-supplied sidebar widgets. Falls back to the
  // plain `pseudo.label` text when no rowBody is registered.
  $: rowBodyApi = pseudo.rowBody
    ? getExtensionApiById(pseudo.source)
    : undefined;

  let bannerHovered = false;
  /** Row-level hover drives the grip expansion — any section of the
   *  row counts, not just the grip column. */
  let rowHovered = false;

  // Resolve the pseudo-workspace color from config. Fallback to the
  // theme accent so rows always render with a solid banner regardless
  // of configuration.
  $: configuredSlot = $configStore.pseudoWorkspaceColors?.[pseudo.id];
  $: bannerBackground = resolveGroupColor(configuredSlot ?? "purple", $theme);

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-pseudo-workspace-row={pseudo.id}
  data-pseudo-position={pseudo.position}
  data-active={isActive ? "true" : undefined}
  style="display: flex; position: relative;"
  on:mouseenter={() => (rowHovered = true)}
  on:mouseleave={() => (rowHovered = false)}
  on:mousedown={(e) => onGripMouseDown?.(e)}
>
  {#if onGripMouseDown}
    <div
      style="
        flex-shrink: 0; align-self: stretch; display: flex;
        background: transparent;
      "
      role="presentation"
    >
      <!-- Drag-start handler lives on the outer row div so hovering
           the banner / body expands the grip and mousedowns anywhere
           initiate reorder. -->
      <DragGrip
        theme={$theme}
        visible={rowHovered && $reorderContext === null}
        ariaLabel="Drag to reorder"
        railColor={$theme.border ?? "transparent"}
        dotColor={$theme.fgDim ?? $theme.fg}
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
        background: {isActive
        ? ($theme.bgActive ??
          $theme.bgHighlight ??
          $theme.bgSurface ??
          'transparent')
        : bannerHovered
          ? ($theme.bgHighlight ?? $theme.bgSurface ?? 'transparent')
          : ($theme.bgSurface ?? 'transparent')};
        color: {$theme.fg};
        border: 1px solid {isActive
        ? 'transparent'
        : ($theme.border ?? 'transparent')};
        border-radius: 6px;
        cursor: pointer;
        outline: {isActive ? `1.5px solid ${bannerBackground}` : 'none'};
        outline-offset: -1.5px;
        transition: background 0.15s;
      "
    >
      <div
        style="padding: 0 8px; display: flex; align-items: center; justify-content: {pseudo.rowBody
          ? 'space-evenly'
          : 'center'}; gap: 8px; min-height: 32px; min-width: 0;"
      >
        {#if pseudo.icon}
          <span
            data-pseudo-workspace-icon
            style="display: inline-flex; flex-shrink: 0; width: 18px; height: 18px; align-items: center; justify-content: center; color: {bannerBackground};"
          >
            <svelte:component this={pseudo.icon as Component} />
          </span>
        {/if}
        {#if pseudo.rowBody && rowBodyApi}
          <div
            data-pseudo-workspace-row-body
            style="display: flex; align-items: center;"
          >
            <ExtensionWrapper api={rowBodyApi} component={pseudo.rowBody} />
          </div>
        {:else}
          <span
            data-pseudo-workspace-label
            style="font-weight: 500; font-size: 13px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
          >
            {pseudo.label}
          </span>
        {/if}
      </div>
    </div>
  </div>
</div>
