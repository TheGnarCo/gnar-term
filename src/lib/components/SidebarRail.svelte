<script lang="ts">
  /**
   * SidebarRail — shared drag rail (DragGrip + lock / close handling)
   * used by both SidebarElement (single-row rail) and SidebarBanner's
   * root variant (multi-row rail that stretches the full banner height).
   *
   * Hover state for the rail is CSS-driven inside DragGrip itself
   * (`:hover` on `.drag-grip`). Previously this component tracked
   * `mouseenter`/`mouseleave` in JS and synced state via a
   * `pointerInsideWindow` watcher — necessary because the rail sits at
   * the leftmost viewport edge and a fast cursor exit could skip its
   * `mouseleave`, leaving the rail stuck in its hovered look. Letting
   * CSS own the hover signal removes that whole class of dropped-event
   * bug; we only forward `isDragging` (force flag) and a `canHover`
   * gate so locked rails and globally-disabled drag still suppress
   * hover effects.
   *
   * Modes:
   *   - "row":       1-row rail. No external border. Close button is
   *                  rendered separately by the row chrome (right edge).
   *   - "container": full-height rail. Paints top/bottom border in
   *                  `color`, optional active-child accent stripe, and
   *                  hosts the close button inside the grip.
   */
  import { theme } from "../stores/theme";
  import { sidebarVisible, canSidebarDrag } from "../stores/ui";
  import DragGrip from "./DragGrip.svelte";
  import { botHatColor } from "../utils/bot-hat-color";

  export let mode: "row" | "container" = "row";

  /** Rail color (child workspace accent, workspace hex, etc.). */
  export let color: string;

  /** Whether dragging is enabled. */
  export let canDrag: boolean = false;

  /** Whether the owning row/container is locked. */
  export let locked: boolean = false;

  /** True while this row is being dragged (row mode keeps grip visible). */
  export let isDragging: boolean = false;

  /** Container mode: paint a 1px accent stripe at the rail's left edge. */
  export let hasActiveStripe: boolean = false;

  /**
   * Whether the owning row/container represents the active workspace (or
   * has an active descendant in container mode). Drives rail-width in
   * collapsed sidebar mode: active rails stay 8px so the active row
   * remains visually anchored, inactive rails shrink to 4px and expand
   * back to 8px on hover. Has no effect when the sidebar is expanded.
   */
  export let isActive: boolean = false;

  /**
   * True while the row's hover banner/popover is open. Treated like a
   * hover signal for rail width: the rail stays at 8px while the popover
   * is showing, even if the cursor has left the rail itself for the
   * popover body. Has no effect when the sidebar is expanded.
   */
  export let popoverActive: boolean = false;
  /**
   * Bot status for the row this rail belongs to. Drives the hat
   * overlay rendered by DragGrip — pulsing yellow for "attention",
   * green for "thinking", muted-grey for "idle", nothing for
   * "none". Renders at every sidebar width so bot presence stays
   * visible whether the sidebar is collapsed or expanded.
   */
  export let botStatus: "none" | "thinking" | "attention" | "idle" = "none";

  /** Mousedown handler for drag start. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  /**
   * Click handler for the rail itself. Lets the rail behave as an
   * activation target — clicking the colored stripe activates the row /
   * container that owns it. The grip's internal close button stops
   * propagation, so closing never doubles as an activate.
   */
  export let onClick: (() => void) | undefined = undefined;

  /** Container mode: rail-mounted close button. */
  export let onClose: (() => void) | undefined = undefined;

  /** Tooltip for the rail-mounted close button. */
  export let closeTooltip: string | undefined = undefined;

  $: effectiveCanDrag = canDrag && $canSidebarDrag;
  $: railBorderColor = $theme.border ?? "transparent";
  // Top-border color matches the bot-hat's color when the rail is
  // hatted, so the segment of the workspace border at the hat's
  // section reads as part of the hat rather than the rail's accent.
  // Falls back to the active-rail accent or the neutral border color
  // otherwise, preserving the existing look for hat-less rows.
  $: hatColor = botHatColor(botStatus);
  $: topBorderColor = hatColor ?? (isActive ? color : railBorderColor);
  // Collapsed mode rail-width policy: thin (4px) when inactive and the
  // row isn't being dragged or showing a popover. Hover no longer
  // factors in — DragGrip's CSS owns the hover look, and the 4px stripe
  // is intentionally preserved through hover anyway (see narrowRail
  // notes on DragGrip).
  $: narrowRail =
    !$sidebarVisible && !isActive && !isDragging && !popoverActive;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-sidebar-rail={mode}
  class:rail-container={mode === "container"}
  class:collapsed-borderless={mode === "container" && narrowRail}
  role="presentation"
  on:mousedown={(e) => {
    if (effectiveCanDrag && onGripMouseDown) onGripMouseDown(e);
  }}
  on:click={() => onClick?.()}
  style="
    display: flex;
    position: relative;
    {mode === 'container'
    ? `flex-shrink: 0; align-self: stretch; box-sizing: border-box;
         --rail-border-top-color: ${topBorderColor};
         --rail-border-bottom-color: ${isActive ? color : railBorderColor};`
    : ''}
  "
>
  <DragGrip
    theme={$theme}
    canHover={effectiveCanDrag && !locked}
    forceHover={isDragging}
    railColor={color}
    railOpacity={1}
    alwaysShowDots={!locked}
    onClose={mode === "container" && !locked ? onClose : undefined}
    {closeTooltip}
    {locked}
    {narrowRail}
    {botStatus}
    primaryClickable={!$sidebarVisible && !!onClick}
  />
  {#if mode === "container" && hasActiveStripe}
    <!-- Active-descendant stripe. When a hat is painted, the stripe
         starts below the hat so it never reads as "1px of workspace
         accent framing the hat" — the hat owns the top 12px and the
         stripe owns everything below it. -->
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: {hatColor ? '12px' : '0'};
        left: 0; bottom: 0;
        width: 1px;
        background: {color};
        pointer-events: none;
        z-index: 4;
      "
    ></div>
  {/if}
</div>

<style>
  /* Container-mode borders are CSS-driven so the collapsed-borderless
     :hover rule below can override the color without fighting inline
     styles. Colors come in as CSS custom properties set inline by the
     component template (`--rail-border-top-color` / `--rail-border-bottom-color`),
     so the existing reactive logic for hat/active/theme.border colors
     still drives the rendered values. */
  .rail-container {
    border-top: 1px solid var(--rail-border-top-color);
    border-bottom: 1px solid var(--rail-border-bottom-color);
  }
  /* Collapsed-mode banner rails: when the row is in narrow-rail state
     (sidebar collapsed AND inactive/idle/no popover/no drag), the
     small top + bottom 1px caps that frame the rail read as dark
     tick marks above and below each workspace banner. Hide them by
     default and let CSS `:hover` reveal them on demand — a deliberate
     hover still surfaces the frame, but the resting collapsed state
     is a clean colored stripe with nothing capping it. */
  .rail-container.collapsed-borderless {
    border-top-color: transparent;
    border-bottom-color: transparent;
  }
  .rail-container.collapsed-borderless:hover {
    border-top-color: var(--rail-border-top-color);
    border-bottom-color: var(--rail-border-bottom-color);
  }
</style>
