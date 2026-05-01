<script lang="ts">
  /**
   * PrimarySidebarElement — unified row chrome (drag grip, close/lock,
   * hover/active states, optional group banner gradient) for the
   * primary sidebar.
   *
   * Used by WorkspaceItem (workspace rows, including dashboard rows) and
   * by ContainerRow's nested-inside-parent variant. The root ContainerRow
   * variant builds its own banner because its rail spans multiple rows;
   * see that file for details.
   *
   * The wrapper itself is intentionally inert — callers that want a
   * clickable row attach interactivity inside the slot. The wrapper only
   * forwards context-menu events.
   */
  import { theme } from "../stores/theme";
  import SidebarRail from "./SidebarRail.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";
  import { shortcutHint } from "../actions/shortcut-hint";

  /** Whether this is a group (renders gradient pattern) */
  export let isGroup: boolean = false;

  /** Whether to use compact sizing (smaller height/padding) */
  export let isCompact: boolean = false;

  /** Whether this is a nested item (reduces vertical padding) */
  export let isNested: boolean = false;

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

  /** Floating ⌘N hint label shown when shortcut hints are active. */
  export let shortcutLabel: string | undefined = undefined;

  let isHovered = false;

  $: effectiveColor = color || $theme.accent;
  $: showClose = canClose && !isDragging && !isGroup && !isLocked && isHovered;
  $: showLock = isLocked && !isDragging && !isGroup;
  $: verticalPadding = isCompact || isNested ? "0px" : "4px";
</script>

<div
  use:shortcutHint={shortcutLabel}
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
  on:contextmenu|preventDefault={onContextMenu}
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
  role="presentation"
>
  <SidebarRail
    mode="row"
    color={effectiveColor}
    {canDrag}
    locked={isLocked}
    {isDragging}
    {onGripMouseDown}
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
      padding: {verticalPadding} {isCompact ? '8px' : '6px'};
      min-height: 100%;
    "
  >
    <slot />
  </div>

  {#if showClose || showLock}
    <div
      style="position: absolute; top: 50%; right: 6px; transform: translateY(-50%);"
    >
      <SidebarChipButton
        variant={isLocked ? "lock" : "close"}
        title={isLocked ? "Unlock Workspace" : `Close ${name}`}
        onClick={onClose}
      />
    </div>
  {/if}
</div>
