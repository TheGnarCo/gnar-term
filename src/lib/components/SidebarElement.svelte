<script lang="ts">
  /**
   * SidebarElement — unified row chrome (drag rail, close/lock,
   * hover/active states, optional anchor gradient) for the sidebar.
   *
   * Used by WorkspaceRow (member rows) and by AnchorRow's nested-anchor
   * variant. The wrapper itself is intentionally inert — callers that
   * want a clickable row attach interactivity inside the slot. The
   * wrapper only forwards context-menu events.
   *
   * Ported from dev with the `dashboard` kind and bot-status machinery
   * dropped. `kind` is `parent` (anchor gradient rail) or `child`
   * (member row).
   */
  import { theme } from "../stores/theme";
  import SidebarRail from "./SidebarRail.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";

  /**
   * Row variant.
   *   - "parent" — anchor row. Renders the gradient rail; close/lock
   *                affordances are suppressed (the anchor manages closure
   *                on its own bar).
   *   - "child"  — regular member row. 32px, close button, no gradient.
   */
  export let kind: "parent" | "child" = "child";

  /**
   * Density modifier for `kind: "child"`. When rendered inside an anchor
   * group, callers pass `compact={true}` so vertical padding collapses to
   * 0. Ignored for `kind: "parent"`.
   */
  export let compact: boolean = false;

  /** Display name/label. */
  export let name: string = "";

  /** Whether this element is currently active. */
  export let isActive: boolean = false;

  /** True while this row's collapsed-mode hover popover is open. */
  export let popoverActive: boolean = false;

  /** Whether this element is locked (shows lock chip instead of close). */
  export let isLocked: boolean = false;

  /** Whether drag is currently in progress for this row. */
  export let isDragging: boolean = false;

  /** Whether dragging is enabled for this element. */
  export let canDrag: boolean = false;

  /** Whether the close button should be shown. */
  export let canClose: boolean = false;

  /** Color for the left rail (member accent, workspace hex, etc.). */
  export let color: string = "";

  /** Callback when the drag rail is pressed. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  /** Callback when the rail itself is clicked. */
  export let onRailClick: (() => void) | undefined = undefined;

  /** Callback when the close button is clicked. */
  export let onClose: (() => void) | undefined = undefined;

  /** Callback when a context menu is requested. */
  export let onContextMenu: ((e: MouseEvent) => void) | undefined = undefined;

  /** Optional data attributes for debugging/testing. */
  export let dataDragIdx: number | undefined = undefined;
  export let dataWorkspaceId: string | undefined = undefined;

  let isHovered = false;

  $: effectiveColor = color || $theme.accent;
  $: isParent = kind === "parent";
  $: showClose = canClose && !isDragging && !isParent && !isLocked && isHovered;
  $: showLock = isLocked && !isDragging && !isParent;
  $: verticalPadding = compact ? "0px" : "4px";
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-sidebar-element={isParent ? "workspace" : "member"}
  data-active={isActive ? "true" : undefined}
  data-drag-idx={dataDragIdx}
  data-workspace-id={dataWorkspaceId}
  style="
    display: {isDragging ? 'none' : 'flex'};
    position: relative;
    min-height: 32px;
    margin: 0 4px 0 0;
    border-radius: 0 6px 6px 0;
    overflow: visible;
    cursor: pointer;
    background: {isActive
    ? $theme.bgActive
    : isHovered
      ? $theme.bgHighlight
      : ($theme.bgSurface ?? 'transparent')};
    border-top: 1px solid {isActive
    ? effectiveColor
    : ($theme.border ?? 'transparent')};
    border-right: 1px solid {isActive
    ? effectiveColor
    : ($theme.border ?? 'transparent')};
    border-bottom: 1px solid {isActive
    ? effectiveColor
    : ($theme.border ?? 'transparent')};
    border-left: none;
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
    {isActive}
    {popoverActive}
    {onGripMouseDown}
    onClick={onRailClick}
  />
  {#if isParent}
    <!-- Anchor gradient rail. -->
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
      padding: {verticalPadding} 6px;
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
