<script lang="ts">
  /**
   * PrimarySidebarElement — unified component for all primary sidebar rows:
   * workspace rows (root and nested), group banners, and dashboard tiles.
   * Encapsulates the chrome (drag grip, close/lock buttons, hover states)
   * so styling and behavior remain consistent across the sidebar.
   *
   * Used by WorkspaceItem, ContainerRow, and dashboard tile rendering.
   */
  import { theme } from "../stores/theme";
  import { anyReorderActive } from "../stores/ui";
  import DragGrip from "./DragGrip.svelte";
  import CloseIcon from "../icons/CloseIcon.svelte";
  import LockIcon from "../icons/LockIcon.svelte";

  /** Whether this is a group (renders gradient pattern) */
  export let isGroup: boolean = false;

  /** Whether close button shows always (not just on hover) */
  export let alwaysShowClose: boolean = false;

  /** Whether to use compact sizing (smaller height/padding) */
  export let isCompact: boolean = false;

  /** Display name/label */
  export let name: string = "";

  /** Whether this element is currently active */
  export let isActive: boolean = false;

  /** Whether this element is locked (shows lock icon instead of close) */
  export let isLocked: boolean = false;

  /** Whether drag is currently in progress */
  export let isDragging: boolean = false;

  /** Whether dragging is enabled for this element */
  export let canDrag: boolean = false;

  /** Whether the close button should be shown */
  export let canClose: boolean = false;

  /** Color for the left rail (workspace accent, group hex, etc.) */
  export let color: string = "";

  /** For groups: whether any nested workspace is active */
  export let hasActiveChild: boolean = false;

  /** Callback when drag grip is pressed */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  /** Callback when close button is clicked */
  export let onClose: (() => void) | undefined = undefined;

  /** Callback when context menu is requested */
  export let onContextMenu: ((e: MouseEvent) => void) | undefined = undefined;

  /** Optional data attributes for debugging/testing */
  export let dataDragIdx: number | undefined = undefined;
  export let dataWorkspaceId: string | undefined = undefined;
  export let dataWorktree: string | undefined = undefined;

  let isHovered = false;
  let isButtonHovered = false;

  $: effectiveColor = color || $theme.accent;
  $: showClose =
    canClose &&
    !isDragging &&
    !isGroup &&
    !isLocked &&
    (alwaysShowClose || isHovered);
  $: showLock = isLocked && isHovered && !isDragging && !isGroup;
</script>

<div
  role="button"
  tabindex="0"
  data-sidebar-element={isGroup ? "group" : "workspace"}
  data-active={isActive ? "true" : undefined}
  data-drag-idx={dataDragIdx}
  data-workspace-id={dataWorkspaceId}
  data-worktree={dataWorktree}
  style="
    display: {isDragging ? 'none' : 'flex'};
    position: relative;
    min-height: {isCompact ? '30px' : '32px'};
    margin: 0 8px 0 0;
    border-radius: 0 6px 6px 0;
    overflow: hidden;
    cursor: pointer;
    background: {isActive
    ? $theme.bgActive
    : isHovered
      ? $theme.bgHighlight
      : ($theme.bgSurface ?? 'transparent')};
    border: 1px solid {isActive
    ? effectiveColor
    : ($theme.border ?? 'transparent')};
    transition: background 0.1s;
  "
  on:click
  on:keydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.currentTarget.click();
    }
  }}
  on:contextmenu|preventDefault={onContextMenu}
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
  on:mousedown={onGripMouseDown}
>
  <DragGrip
    theme={$theme}
    visible={isDragging || (canDrag && isHovered && !$anyReorderActive)}
    railColor={effectiveColor}
    railOpacity={1}
    alwaysShowDots={!isLocked}
  />
  {#if isGroup}
    <!-- Group banner rail gradient -->
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 0; bottom: 0;
        left: 0; width: 14px;
        pointer-events: none;
        background-image:
          radial-gradient(circle, {effectiveColor} 1.1px, transparent 1.6px),
          radial-gradient(circle, {effectiveColor} 1.1px, transparent 1.6px);
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

  <!-- Content slot: icon, label, status, etc. -->
  <div
    style="
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 8px;
      padding: {isCompact ? '0 8px' : '4px 6px'};
      min-height: 100%;
    "
  >
    <slot />
  </div>

  <!-- Close/Lock buttons (right side) -->
  {#if showClose || showLock}
    <button
      title={isLocked ? "Unlock Workspace" : `Close ${name}`}
      aria-label={isLocked ? "Unlock Workspace" : `Close ${name}`}
      style="
        position: absolute; top: 50%; right: 6px;
        transform: translateY(-50%);
        display: flex; align-items: center; justify-content: center;
        width: 14px; height: 14px;
        color: {isButtonHovered
        ? isLocked
          ? $theme.fg
          : $theme.danger
        : effectiveColor};
        background: transparent;
        border: none;
        border-radius: 3px; cursor: pointer; padding: 0;
        line-height: 1;
        transition: color 0.1s, border-color 0.1s;
        -webkit-app-region: no-drag;
        flex-shrink: 0;
      "
      on:mousedown|stopPropagation
      on:mouseenter={() => (isButtonHovered = true)}
      on:mouseleave={() => (isButtonHovered = false)}
      on:click|stopPropagation={onClose}
    >
      {#if isLocked}
        <LockIcon width="9" height="9" />
      {:else}
        <CloseIcon width="9" height="9" />
      {/if}
    </button>
  {/if}
</div>

<style>
  div[role="button"] {
    outline: none;
  }

  div[role="button"]:focus-visible {
    outline: 2px solid var(--focus-color, currentColor);
    outline-offset: -1px;
  }
</style>
