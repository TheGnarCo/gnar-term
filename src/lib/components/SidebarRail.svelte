<script lang="ts">
  /**
   * SidebarRail — shared drag rail (DragGrip + lock/close handling) used
   * by both SidebarElement (single-row rail, `mode="row"`) and the
   * AnchorRow (multi-row rail that stretches the full group height,
   * `mode="group"`).
   *
   * Modes:
   *   - "row":   1-row rail. No external border. Close button is rendered
   *              separately by the row chrome (right edge).
   *   - "group": full-height rail. Paints top/bottom border in `color`,
   *              an optional active-descendant accent stripe, and hosts
   *              the close button inside the grip.
   *
   * Ported from dev's `mode="row"` / `mode="container"` rail; the
   * container mode is renamed `group` and bot-status (hat) machinery is
   * dropped. The collapsed-mode width policy (KEEP per RESOLVED risk 4)
   * is preserved: active rails stay 8px, inactive/non-hovered rails
   * shrink to 4px when the sidebar is collapsed.
   */
  import { theme } from "../stores/theme";
  import { sidebarVisible } from "../stores/ui";
  import DragGrip from "./DragGrip.svelte";

  export let mode: "row" | "group" = "row";

  /** Rail color (member accent, workspace hex, etc.). */
  export let color: string;

  /** Whether dragging is enabled. */
  export let canDrag: boolean = false;

  /** Whether the owning row/group is locked. */
  export let locked: boolean = false;

  /** True while this row is being dragged (row mode keeps grip visible). */
  export let isDragging: boolean = false;

  /** Group mode: paint a 1px accent stripe at the rail's left edge. */
  export let hasActiveStripe: boolean = false;

  /**
   * Whether the owning row/group is active (or has an active descendant
   * in group mode). Drives collapsed-mode rail width: active rails stay
   * 8px, inactive rails shrink to 4px and expand back on hover. No effect
   * when the sidebar is expanded.
   */
  export let isActive: boolean = false;

  /**
   * True while the row's collapsed-mode hover popover is open. Treated
   * like a hover signal for rail width so the rail stays at 8px while the
   * popover shows. No effect when the sidebar is expanded.
   */
  export let popoverActive: boolean = false;

  /** Mousedown handler for drag start. */
  export let onGripMouseDown: ((e: MouseEvent) => void) | undefined = undefined;

  /** Click handler for the rail itself (activates the owning row/group). */
  export let onClick: (() => void) | undefined = undefined;

  /** Group mode: rail-mounted close button. */
  export let onClose: (() => void) | undefined = undefined;

  /** Tooltip for the rail-mounted close button. */
  export let closeTooltip: string | undefined = undefined;

  $: railBorderColor = $theme.border ?? "transparent";
  $: topBorderColor = isActive ? color : railBorderColor;
  $: narrowRail =
    !$sidebarVisible && !isActive && !isDragging && !popoverActive;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-sidebar-rail={mode}
  class:rail-group={mode === "group"}
  class:collapsed-borderless={mode === "group" && narrowRail}
  role="presentation"
  on:mousedown={(e) => {
    if (canDrag && onGripMouseDown) onGripMouseDown(e);
  }}
  on:click={() => onClick?.()}
  style="
    display: flex;
    position: relative;
    {mode === 'group'
    ? `flex-shrink: 0; align-self: stretch; box-sizing: border-box;
         --rail-border-top-color: ${topBorderColor};
         --rail-border-bottom-color: ${isActive ? color : railBorderColor};`
    : ''}
  "
>
  <DragGrip
    theme={$theme}
    canHover={canDrag && !locked}
    forceHover={isDragging}
    railColor={color}
    railOpacity={1}
    alwaysShowDots={!locked}
    onClose={mode === "group" && !locked ? onClose : undefined}
    {closeTooltip}
    {locked}
    {narrowRail}
    primaryClickable={!$sidebarVisible && !!onClick}
  />
  {#if mode === "group" && hasActiveStripe}
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 0;
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
  .rail-group {
    border-top: 1px solid var(--rail-border-top-color);
    border-bottom: 1px solid var(--rail-border-bottom-color);
  }
  .rail-group.collapsed-borderless {
    border-top-color: transparent;
    border-bottom-color: transparent;
  }
  .rail-group.collapsed-borderless:hover {
    border-top-color: var(--rail-border-top-color);
    border-bottom-color: var(--rail-border-bottom-color);
  }
</style>
