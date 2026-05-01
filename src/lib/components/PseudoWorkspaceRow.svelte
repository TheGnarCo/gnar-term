<script lang="ts">
  /**
   * PseudoWorkspaceRow — root-row chrome for entries registered via
   * `registerPseudoWorkspace`. Mirrors WorkspaceItem's left-rail look
   * so the Global Agentic Dashboard sits visually alongside dashboard
   * workspace rows (Claude Code, Settings), with one deliberate
   * difference: no name label when a `rowBody` is registered — the
   * rowBody (e.g. AgentStatusGrid chips) occupies the title slot.
   *
   * When `pseudo.onClose` is defined the row renders a hover-revealed ×
   * button at its right edge. Clicking it unregisters the entry and
   * calls onClose() so the registrar can wire up a reopen affordance.
   */
  import { theme } from "../stores/theme";
  import { reorderContext } from "../stores/ui";
  import {
    activePseudoWorkspaceId,
    activeWorkspaceIdx,
  } from "../stores/workspace";
  import DragGrip from "./DragGrip.svelte";
  import CloseIcon from "../icons/CloseIcon.svelte";
  import ExtensionWrapper from "./ExtensionWrapper.svelte";
  import { getExtensionApiById } from "../services/extension-loader";
  import type { Component } from "svelte";
  import {
    type PseudoWorkspace,
    unregisterPseudoWorkspace,
  } from "../services/pseudo-workspace-registry";
  import { configStore } from "../config";
  import { resolveGroupColor } from "../theme-data";
  import { shortcutHint } from "../actions/shortcut-hint";
  import { modLabel } from "../terminal-service";

  export let pseudo: PseudoWorkspace;
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** Sidebar position index for the ⌘N shortcut hint. */
  export let shortcutIdx: number | undefined = undefined;

  $: rowBodyApi = pseudo.rowBody
    ? getExtensionApiById(pseudo.source)
    : undefined;

  let rowHovered = false;

  $: configuredSlot = $configStore.pseudoWorkspaceColors?.[pseudo.id];
  $: bannerBackground = resolveGroupColor(configuredSlot ?? "purple", $theme);

  function activate(): void {
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
  $: gripVisible = rowHovered && $reorderContext === null;

  function handleClose(): void {
    unregisterPseudoWorkspace(pseudo.id);
    pseudo.onClose?.();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-pseudo-workspace-row={pseudo.id}
  data-pseudo-position={pseudo.position}
  data-active={isActive ? "true" : undefined}
  role="button"
  tabindex="0"
  aria-label={pseudo.label}
  use:shortcutHint={shortcutIdx !== undefined && shortcutIdx < 9
    ? `${modLabel}${shortcutIdx + 1}`
    : undefined}
  style="
    display: flex;
    position: relative;
    margin: 0 8px 0 0;
    border-radius: 0 6px 6px 0;
    overflow: hidden;
    cursor: pointer;
    background: {isActive
    ? $theme.bgActive
    : rowHovered
      ? $theme.bgHighlight
      : ($theme.bgSurface ?? 'transparent')};
    border: 1px solid {isActive
    ? bannerBackground
    : ($theme.border ?? 'transparent')};
  "
  on:click={activate}
  on:keydown={onBannerKeydown}
  on:mouseenter={() => (rowHovered = true)}
  on:mouseleave={() => (rowHovered = false)}
  on:mousedown={(e) => onGripMouseDown?.(e)}
>
  {#if onGripMouseDown}
    <DragGrip
      theme={$theme}
      visible={gripVisible}
      railColor={bannerBackground}
      railOpacity={1}
      alwaysShowDots={true}
    />
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 0; bottom: 0;
        left: 0; width: 14px;
        pointer-events: none;
        background-image:
          radial-gradient(circle, {bannerBackground} 1.1px, transparent 1.6px),
          radial-gradient(circle, {bannerBackground} 1.1px, transparent 1.6px);
        background-size: 5px 5px;
        background-position: 0 0, 2.5px 2.5px;
        background-repeat: repeat;
        -webkit-mask-image: linear-gradient(
          to right,
          rgba(0, 0, 0, 1) 0%,
          rgba(0, 0, 0, 0.3) 20%,
          rgba(0, 0, 0, 0) 70%
        );
        mask-image: linear-gradient(
          to right,
          rgba(0, 0, 0, 1) 0%,
          rgba(0, 0, 0, 0.3) 20%,
          rgba(0, 0, 0, 0) 70%
        );
      "
    ></div>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    style="
      flex: 1; min-width: 0;
      padding: 4px 6px;
      display: flex; align-items: center; gap: 8px;
      min-height: 32px;
    "
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
        style="display: flex; align-items: center; flex: 1; min-width: 0;"
      >
        <ExtensionWrapper api={rowBodyApi} component={pseudo.rowBody} />
      </div>
    {:else}
      <span
        data-pseudo-workspace-label
        style="font-weight: {isActive
          ? '600'
          : '400'}; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: {isActive
          ? $theme.fg
          : $theme.fgMuted};"
      >
        {pseudo.label}
      </span>
    {/if}
  </div>
  {#if pseudo.onClose}
    <!-- Close button positioned at right edge, matching WorkspaceItem style -->
    <button
      title={"Close " + pseudo.label}
      aria-label={"Close " + pseudo.label}
      style="
        position: absolute; top: 50%; right: 6px;
        transform: translateY(-50%);
        display: flex; align-items: center; justify-content: center;
        width: 14px; height: 14px;
        color: {rowHovered ? $theme.danger : bannerBackground};
        background: transparent;
        border: none;
        border-radius: 3px; cursor: pointer; padding: 0;
        line-height: 1;
        transition: color 0.1s, border-color 0.1s;
        -webkit-app-region: no-drag;
      "
      on:mousedown|stopPropagation
      on:click|stopPropagation={handleClose}
      on:mouseenter={() => (rowHovered = true)}
      on:mouseleave={() => (rowHovered = false)}
    >
      <CloseIcon width="9" height="9" />
    </button>
  {/if}
</div>
