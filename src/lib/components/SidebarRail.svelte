<script lang="ts">
  /**
   * SidebarRail — shared drag rail (DragGrip + hover scoping + lock /
   * close handling) used by both SidebarElement (single-row rail)
   * and SidebarBanner's root variant (multi-row rail that stretches the
   * full banner height).
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

  let railHovered = false;

  $: effectiveCanDrag = canDrag && $canSidebarDrag;
  $: visible = isDragging || (effectiveCanDrag && railHovered && !locked);
  $: railBorderColor = $theme.border ?? "transparent";
  // Collapsed mode rail-width policy: thin (4px) when inactive and the
  // row isn't being dragged or showing a popover. Hovering the rail no
  // longer widens the painted color — the 8px wrapper still catches the
  // hover for popover triggering, but the rendered stripe stays at 4px
  // so hover doesn't visually overlap the active-rail width. Expanded
  // mode keeps the historical 8px rail regardless of state.
  $: narrowRail =
    !$sidebarVisible && !isActive && !isDragging && !popoverActive;
</script>

<!-- The rail occupies the leftmost 8px of the row, flush with the
     viewport edge. A cursor exit through that edge can skip the rail's
     own `mouseleave`, leaving the grip's expanded "hover pattern" stuck
     visible. Body-level mouseleave is the authoritative "cursor left
     the app" signal and resets the rail-hover state. -->
<svelte:body on:mouseleave={() => (railHovered = false)} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-sidebar-rail={mode}
  role="presentation"
  on:mouseenter={() => (railHovered = true)}
  on:mouseleave={() => (railHovered = false)}
  on:mousedown={(e) => {
    if (railHovered && effectiveCanDrag && onGripMouseDown) {
      onGripMouseDown(e);
    }
  }}
  on:click={() => onClick?.()}
  style="
    display: flex;
    position: relative;
    {mode === 'container'
    ? `flex-shrink: 0; align-self: stretch; box-sizing: border-box;
         ${$sidebarVisible ? `border-left: 1px solid ${railBorderColor};` : ''}
         border-top: 1px solid ${isActive ? color : railBorderColor};
         border-bottom: 1px solid ${isActive ? color : railBorderColor};`
    : ''}
  "
>
  <DragGrip
    theme={$theme}
    {visible}
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
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 0; left: 0; bottom: 0;
        width: 1px;
        background: {color};
        pointer-events: none;
        z-index: 4;
      "
    ></div>
  {/if}
</div>
