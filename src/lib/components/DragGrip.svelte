<script lang="ts">
  import type { ThemeDef } from "../theme-data";

  export let theme: ThemeDef;
  export let visible: boolean = false;
  /**
   * Optional mousedown binding. Consumers now typically attach the drag
   * start handler at the row level (so hovering the row expands the
   * grip and mousedowns on the body also initiate reorder). The prop
   * stays optional for callers that still want a grip-only binding.
   */
  export let onMouseDown: ((e: MouseEvent) => void) | undefined = undefined;
  /** Color of the rail and dot texture. Defaults to theme.fgDim (grey). */
  export let railColor: string | undefined = undefined;
  /** Opacity of the always-on rail when not hovered. 1.0 for active items, 0.35 for inactive. */
  export let railOpacity: number = 0.5;
  /**
   * Override color for the staggered dot pattern. Defaults to railColor.
   */
  export let dotColor: string | undefined = undefined;
  /**
   * When true, the dot pattern renders whether or not the grip is in the
   * `visible` (hover/drag) state — so a colored frit is always shown on
   * the rail. The rail stripe is suppressed in this mode to avoid
   * painting two layers on top of each other.
   */
  export let alwaysShowDots: boolean = false;
  /**
   * When true, the dot pattern is masked with a left-to-right
   * gradient so the rail's right edge softens into the row content.
   * Default false — workspace rails opt in; project rails stay
   * unfaded so the pattern runs the full rail height cleanly.
   */
  export let fadeRight: boolean = false;

  $: effectiveColor = railColor ?? theme.fgDim;
  $: effectiveDotColor = dotColor ?? effectiveColor;
  $: showDots = visible || alwaysShowDots;
  $: showRailStripe = !showDots;

  // Frit pattern stays identical across rest and hover states — same
  // dot size, softness, color, and opacity. Only the rail's WIDTH
  // changes on hover, so "expanded" reads as the same knurl extended
  // wider, not a beefier/brighter variant.
  const dotRadius = "1.1px";
  const dotFade = "1.6px";
  $: fritBackgroundImage = `radial-gradient(circle, ${effectiveDotColor} ${dotRadius}, transparent ${dotFade}), radial-gradient(circle, ${effectiveDotColor} ${dotRadius}, transparent ${dotFade})`;
  $: fritBackgroundSize = "5px 5px";
  $: fritBackgroundPosition = "0 0, 2.5px 2.5px";
  $: fritBackgroundRepeat = "repeat";
</script>

<div
  aria-hidden="true"
  class="drag-grip"
  on:mousedown={onMouseDown ?? (() => {})}
  style="
    flex-shrink: 0;
    align-self: stretch;
    position: relative;
    width: {visible ? '20px' : '10px'};
    cursor: {visible ? 'grab' : 'default'};
    transition: width 0.12s ease-out;
    overflow: hidden;
  "
>
  <!-- Rail stripe + dot pattern fill the full grip height (no vertical
       inset) so the rail's top + bottom are flush with the row. Inter-
       row breathing is handled by the parent list's margin-top rule
       now, not by an inset inside the grip. -->
  {#if showRailStripe}
    <div
      style="
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 6px;
        background: {effectiveColor};
        opacity: {railOpacity};
      "
    ></div>
  {/if}
  {#if showDots}
    {@const fadeMask =
      "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)"}
    <!-- Frit dot pattern. Optional L→R fade (fadeRight prop) so the
         rail's right edge softens into the row content. Workspaces
         opt in; projects keep the pattern running clean. -->
    <div
      style="
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image: {fritBackgroundImage};
        background-size: {fritBackgroundSize};
        background-position: {fritBackgroundPosition};
        background-repeat: {fritBackgroundRepeat};
        opacity: {railOpacity};
        -webkit-mask-image: {fadeRight ? fadeMask : 'none'};
        mask-image: {fadeRight ? fadeMask : 'none'};
      "
    ></div>
  {/if}
</div>
