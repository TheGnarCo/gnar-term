<script lang="ts">
  /**
   * DragGrip — the colored drag rail at the left edge of a sidebar row
   * or workspace group. Paints a vertical stripe (the row/group accent)
   * that reveals a staggered dot "frit" pattern on hover, and hosts the
   * close/lock chip at the top of the grip.
   *
   * Ported from dev with the agent "dome/hat" (bot-status) machinery
   * stripped — bot status is out of scope. Hover is CSS-driven so cursor
   * exits off the leftmost viewport edge never strand the rail in a
   * hovered look.
   */
  import type { ThemeDef } from "../theme-data";

  export let theme: ThemeDef;
  /** Mousedown binding to arm drag-start (owned by the row's container). */
  export let onMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** Color of the rail and dot texture. Defaults to theme.fgDim (grey). */
  export let railColor: string | undefined = undefined;
  /** Opacity of the always-on rail when not hovered. */
  export let railOpacity: number = 1;
  /** Override color for the staggered dot pattern. Defaults to railColor. */
  export let dotColor: string | undefined = undefined;
  /**
   * When true, the dot pattern renders on hover/force-hover. The rail
   * stripe is hidden whenever the dots are visible so only one layer
   * paints at a time.
   */
  export let alwaysShowDots: boolean = false;
  /** When provided, renders a × chip at the top of the grip on hover. */
  export let onClose: (() => void) | undefined = undefined;
  /** Tooltip text for the close button. */
  export let closeTooltip: string | undefined = undefined;
  /**
   * When true, the grip displays a lock chip instead of a close button
   * and the cursor stops indicating "grab".
   */
  export let locked: boolean = false;
  /**
   * Renders the rail stripe at the slim 4px width instead of 8px.
   * Callers set this in collapsed sidebar mode for inactive, non-hovered
   * rows so the rail reads as a thin accent that expands back to 8px.
   */
  export let narrowRail: boolean = false;
  /**
   * When true, the grip's primary action is a click (activate the row)
   * rather than a drag — cursor reads `pointer` instead of `grab`. Set in
   * collapsed sidebar mode where the rail is the row's main target.
   */
  export let primaryClickable: boolean = false;
  /**
   * Whether the grip should respond to CSS `:hover` at all. False
   * suppresses hover effects (locked row, drag globally suspended).
   */
  export let canHover: boolean = true;
  /**
   * Force the hover-state visual regardless of CSS `:hover`. Set during
   * drag-in-progress so the rail stays expanded while the pointer leaves.
   */
  export let forceHover: boolean = false;

  let closeButtonHovered = false;
  $: hasClose = onClose != null && !locked;
  $: showLock = locked;

  $: effectiveColor = railColor ?? theme.fgDim;
  $: effectiveDotColor = dotColor ?? effectiveColor;

  const dotRadius = "1.1px";
  const dotFade = "1.6px";
  $: fritBackgroundImage = `radial-gradient(circle, ${effectiveDotColor} ${dotRadius}, transparent ${dotFade}), radial-gradient(circle, ${effectiveDotColor} ${dotRadius}, transparent ${dotFade})`;
  $: railStripeWidth = narrowRail ? "4px" : "8px";
  $: dotsRender = alwaysShowDots && !narrowRail;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  aria-hidden="true"
  class="drag-grip"
  class:can-hover={canHover}
  class:force-hover={forceHover}
  class:locked
  class:primary-clickable={primaryClickable}
  class:narrow-rail={narrowRail}
  class:has-dots={dotsRender}
  on:mousedown={onMouseDown ?? (() => {})}
>
  <div
    class="rail-stripe"
    style="width: {railStripeWidth}; background: {effectiveColor}; opacity: {railOpacity};"
  ></div>

  {#if dotsRender}
    <div
      class="rail-dots"
      style="
        background-image: {fritBackgroundImage};
        background-size: 5px 5px;
        background-position: 0 0, 2.5px 2.5px;
        background-repeat: repeat;
        opacity: {railOpacity};
      "
    ></div>
  {/if}

  {#if hasClose}
    <button
      class="grip-chip close-button"
      title={closeTooltip}
      aria-label={closeTooltip ?? "Close"}
      style="color: {closeButtonHovered ? theme.danger : effectiveColor};"
      on:mousedown|stopPropagation
      on:click|stopPropagation={onClose}
      on:mouseenter={() => (closeButtonHovered = true)}
      on:mouseleave={() => (closeButtonHovered = false)}
    >
      ×
    </button>
  {/if}

  {#if showLock}
    <div
      aria-hidden="true"
      class="grip-chip lock-chip"
      title="Workspace locked"
      style="color: {effectiveColor};"
    >
      🔒
    </div>
  {/if}
</div>

<style>
  .drag-grip {
    flex-shrink: 0;
    align-self: stretch;
    position: relative;
    width: 8px;
    cursor: default;
  }
  .drag-grip.locked {
    cursor: not-allowed;
  }
  .drag-grip.primary-clickable:not(.locked) {
    cursor: pointer;
  }
  .drag-grip.can-hover:not(.locked):not(.primary-clickable):hover,
  .drag-grip.force-hover:not(.locked):not(.primary-clickable) {
    cursor: grab;
  }

  .rail-stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    transition: width 0.1s;
  }
  .drag-grip.has-dots.can-hover:hover .rail-stripe,
  .drag-grip.has-dots.force-hover .rail-stripe {
    display: none;
  }

  .rail-dots {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 8px;
    pointer-events: none;
    display: none;
  }
  .drag-grip.has-dots.can-hover:hover .rail-dots,
  .drag-grip.has-dots.force-hover .rail-dots {
    display: block;
  }

  .grip-chip {
    position: absolute;
    top: 4px;
    left: 1px;
    right: 1px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    overflow: hidden;
    z-index: 4;
    font-size: 13px;
    line-height: 1;
  }

  .close-button {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    -webkit-app-region: no-drag;
    transition: color 0.1s;
    display: none;
  }
  .drag-grip.can-hover:hover .close-button,
  .drag-grip.force-hover .close-button {
    display: flex;
  }

  .lock-chip {
    background: transparent;
    border: none;
    pointer-events: none;
    font-size: 9px;
  }
</style>
