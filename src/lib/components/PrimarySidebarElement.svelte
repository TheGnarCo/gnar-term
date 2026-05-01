<script lang="ts">
  /**
   * PrimarySidebarElement — unified row chrome (drag grip, close/lock,
   * hover/active states, optional workspace banner gradient) for the
   * primary sidebar.
   *
   * Used by WorkspaceItem (nested-workspace rows, including dashboard rows)
   * and by ContainerRow's nested-inside-parent variant. The root
   * ContainerRow variant builds its own banner because its rail spans
   * multiple rows; see that file for details.
   *
   * The wrapper itself is intentionally inert — callers that want a
   * clickable row attach interactivity inside the slot. The wrapper only
   * forwards context-menu events.
   */
  import { theme } from "../stores/theme";
  import SidebarRail from "./SidebarRail.svelte";
  import SidebarChipButton from "./SidebarChipButton.svelte";
  import { shortcutHint } from "../actions/shortcut-hint";

  /**
   * Row variant. Drives chrome (banner gradient, close vs no-close,
   * data-sidebar-element marker) and default density:
   *
   *   - "umbrella"  — workspace banner row (ContainerRow). Renders the
   *                   gradient rail; close/lock affordances are
   *                   suppressed because callers manage closure on the
   *                   banner itself.
   *   - "nested"    — regular nested-workspace row (WorkspaceItem).
   *                   Standard 32px height, close button, no banner.
   *   - "dashboard" — workspace's dashboard row. Tighter (30px) height
   *                   with reduced vertical padding.
   */
  export let kind: "umbrella" | "nested" | "dashboard" = "nested";

  /**
   * Density modifier for `kind: "nested"`. When the row is rendered
   * inside an umbrella banner, callers pass `compact={true}` so its
   * vertical padding collapses to 0 — matches dashboard density and
   * prevents the nested list from "breathing" inside the banner.
   * Ignored for `kind: "umbrella"` (banner controls its own padding)
   * and `kind: "dashboard"` (always compact).
   */
  export let compact: boolean = false;

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

  /** Color for the left rail (nested-workspace accent, workspace hex, etc.) */
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
  $: isUmbrella = kind === "umbrella";
  $: isDashboard = kind === "dashboard";
  $: showClose =
    canClose && !isDragging && !isUmbrella && !isLocked && isHovered;
  $: showLock = isLocked && !isDragging && !isUmbrella;
  $: verticalPadding = isDashboard || compact ? "0px" : "4px";
  $: minHeight = isDashboard ? "30px" : "32px";
  $: innerXPadding = isDashboard ? "8px" : "6px";
</script>

<div
  use:shortcutHint={shortcutLabel}
  data-sidebar-element={isUmbrella ? "workspace" : "nested-workspace"}
  data-active={isActive ? "true" : undefined}
  data-drag-idx={dataDragIdx}
  data-workspace-id={dataWorkspaceId}
  data-worktree={dataWorktree}
  style="
    display: {isDragging ? 'none' : 'flex'};
    position: relative;
    min-height: {minHeight};
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
  {#if isUmbrella}
    <!-- Workspace banner rail gradient -->
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
      padding: {verticalPadding} {innerXPadding};
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
