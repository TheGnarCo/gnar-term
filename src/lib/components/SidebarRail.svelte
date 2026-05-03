<script lang="ts">
  /**
   * SidebarRail — shared drag rail (DragGrip + hover scoping + lock /
   * close handling) used by both SidebarElement (single-row rail)
   * and ContainerRow's root variant (multi-row rail that stretches the
   * full container height).
   *
   * Modes:
   *   - "row":       1-row rail. No external border. Close button is
   *                  rendered separately by the row chrome (right edge).
   *   - "container": full-height rail. Paints top/bottom border in
   *                  `color`, optional active-child accent stripe, and
   *                  hosts the close button inside the grip.
   */
  import { theme } from "../stores/theme";
  import { anyReorderActive } from "../stores/ui";
  import DragGrip from "./DragGrip.svelte";

  export let mode: "row" | "container" = "row";

  /** Rail color (nested workspace accent, workspace hex, etc.). */
  export let color: string;

  /** Whether dragging is enabled. */
  export let canDrag: boolean = false;

  /** Whether the owning row/container is locked. */
  export let locked: boolean = false;

  /** True while this row is being dragged (row mode keeps grip visible). */
  export let isDragging: boolean = false;

  /** Container mode: paint a 1px accent stripe at the rail's left edge. */
  export let hasActiveStripe: boolean = false;

  /** Mousedown handler for drag start. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  /** Container mode: rail-mounted close button. */
  export let onClose: (() => void) | undefined = undefined;

  /** Tooltip for the rail-mounted close button. */
  export let closeTooltip: string | undefined = undefined;

  let railHovered = false;

  $: visible =
    isDragging || (canDrag && railHovered && !$anyReorderActive && !locked);
  $: railBorderColor = $theme.border ?? "transparent";
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-sidebar-rail={mode}
  role="presentation"
  on:mouseenter={() => (railHovered = true)}
  on:mouseleave={() => (railHovered = false)}
  on:mousedown={(e) => {
    if (railHovered && onGripMouseDown) {
      onGripMouseDown(e);
    }
  }}
  style="
    display: flex;
    position: relative;
    {mode === 'container'
    ? `flex-shrink: 0; align-self: stretch; box-sizing: border-box;
         border-left: 1px solid ${railBorderColor};
         border-top: 1px solid ${color};
         border-bottom: 1px solid ${color};`
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
