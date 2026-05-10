<script lang="ts">
  import type { ThemeDef } from "../theme-data";
  import { shortcutHintsActive } from "../stores/shortcut-hints";
  import CloseIcon from "../icons/CloseIcon.svelte";
  import LockIcon from "../icons/LockIcon.svelte";
  import { variantColor } from "../status-colors";

  const warningColor = variantColor("warning");
  const successColor = variantColor("success");

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
   * Default false — Branch rails opt in; root Workspace rails stay
   * unfaded so the pattern runs the full rail height cleanly.
   */
  export let fadeRight: boolean = false;
  /** When provided, renders a × chip at the top of the grip whenever the grip is expanded. */
  export let onClose: (() => void) | undefined = undefined;
  /** Tooltip text for the close button. */
  export let closeTooltip: string | undefined = undefined;
  /**
   * When true, the grip displays a lock icon at the top instead of a
   * close button, the cursor stops indicating "grab", and the
   * onMouseDown handler still fires (callers gate drag-start
   * separately so the row can still be selected).
   */
  export let locked: boolean = false;
  /** When set, renders this label in the close/lock slot during meta-hold (shortcutHintsActive). */
  export let shortcutLabel: string | undefined = undefined;
  /**
   * Renders the rail stripe at the slim 4px width instead of the full
   * 8px. Callers set this in collapsed sidebar mode for inactive,
   * non-hovered rows whose popover/banner isn't open, so the rail reads
   * as a thin accent that expands back to 8px the moment any of those
   * conditions flips. The grip wrapper itself stays 8px wide so row
   * layout is unaffected.
   */
  export let narrowRail: boolean = false;
  /**
   * When true, the grip's primary action is a click (activate the row)
   * rather than a drag — so the cursor reads `pointer` instead of
   * `grab`. Callers set this in collapsed sidebar mode where the rail
   * is the row's main interaction target.
   */
  export let primaryClickable: boolean = false;
  /**
   * Collapsed-mode bot status signal. Drives the rail "hat":
   *   - "none":       no hat painted.
   *   - "thinking":   green static hat — at least one agent in the
   *                   tree is running/active but none waiting.
   *   - "attention":  yellow pulsing hat — at least one agent is
   *                   waiting on user input. Highest priority and
   *                   supersedes "thinking".
   *
   * Hats only render when the rail is in `narrowRail` (collapsed
   * sidebar) mode — expanded mode uses per-row badges instead so
   * a hat would be redundant noise.
   */
  export let botStatus: "none" | "thinking" | "attention" = "none";

  let closeButtonHovered = false;
  // shortcutLabel takes priority over close/lock when meta-hold is active.
  $: showShortcut = !!shortcutLabel && $shortcutHintsActive;
  $: showClose = onClose != null && visible && !locked && !showShortcut;
  $: showLock = locked && !showShortcut;

  $: effectiveColor = railColor ?? theme.fgDim;
  $: effectiveDotColor = dotColor ?? effectiveColor;

  // Frit pattern stays identical across rest and hover states — same
  // dot size, softness, color, and geometry. The fade mask is removed
  // on hover (via fadeRight prop) without shifting content.
  const dotRadius = "1.1px";
  const dotFade = "1.6px";
  $: fritBackgroundImage = `radial-gradient(circle, ${effectiveDotColor} ${dotRadius}, transparent ${dotFade}), radial-gradient(circle, ${effectiveDotColor} ${dotRadius}, transparent ${dotFade})`;
  $: fritBackgroundSize = "5px 5px";
  $: fritBackgroundPosition = "0 0, 2.5px 2.5px";
  $: fritBackgroundRepeat = "repeat";
  // In narrow-rail mode the painted color stays at 4px even when the
  // rail is hovered — so the stripe renders regardless of `visible`,
  // and the hover dot pattern is suppressed (it would otherwise paint
  // 8px wide and contradict the 4px policy).
  $: showDots = visible && alwaysShowDots && !narrowRail;
  $: showRailStripe = !visible || narrowRail;
  $: railStripeWidth = narrowRail ? "4px" : "8px";
  // Hat only renders in collapsed-mode (narrowRail). In expanded
  // mode the per-row status badges already cover bot status, so the
  // hat would be redundant noise.
  $: showHat = narrowRail && botStatus !== "none";
  $: hatColor = botStatus === "attention" ? warningColor : successColor;
  $: hatPulses = botStatus === "attention";
</script>

<div
  aria-hidden="true"
  class="drag-grip"
  on:mousedown={onMouseDown ?? (() => {})}
  style="
    flex-shrink: 0;
    align-self: stretch;
    position: relative;
    width: 8px;
    cursor: {locked
    ? 'not-allowed'
    : primaryClickable
      ? 'pointer'
      : visible
        ? 'grab'
        : 'default'};
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
        width: {railStripeWidth};
        background: {effectiveColor};
        opacity: {railOpacity};
        transition: width 0.1s;
      "
    ></div>
  {/if}
  {#if showHat}
    <!-- Bot-status hat overlay: 10px solid color at the top of the
         rail, a 2px dark divider, then the underlying rail stripe
         color shows through. Width matches the narrow rail (4px) so
         the rail does not get visually thicker. The "attention"
         variant pulses via box-shadow; the "thinking" variant is
         static green. The pulse glow survives the rare case where
         the rail color and hat color match (e.g. amber accent +
         yellow attention). -->
    <div
      aria-hidden="true"
      class="rail-bot-hat"
      class:pulses={hatPulses}
      style="
        position: absolute;
        left: 0; top: 0;
        width: 4px;
        height: 12px;
        --rail-hat-glow: {hatColor};
        background: linear-gradient(
          to bottom,
          {hatColor} 0,
          {hatColor} 10px,
          rgba(0, 0, 0, 0.55) 10px,
          rgba(0, 0, 0, 0.55) 12px
        );
        pointer-events: none;
        z-index: 2;
      "
    ></div>
  {/if}
  {#if showDots}
    {@const fadeMask =
      "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)"}
    <!-- Frit dot pattern. Optional L→R fade (fadeRight prop) so the
         rail's right edge softens into the row content. Branches opt
         in; root Workspaces keep the pattern running clean. -->
    <div
      style="
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 8px;
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
  {#if showShortcut}
    <div
      aria-hidden="true"
      style="
        position: absolute;
        top: 4px; left: 1px; right: 1px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: {theme.accent};
        color: {theme.bg};
        border-radius: 3px;
        font-size: 9px;
        font-weight: 700;
        pointer-events: none;
        white-space: nowrap;
        overflow: hidden;
      "
    >
      {shortcutLabel}
    </div>
  {/if}
  {#if showClose}
    <button
      title={closeTooltip}
      aria-label={closeTooltip ?? "Close"}
      style="
        position: absolute;
        top: 4px; left: 1px; right: 1px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: {closeButtonHovered ? theme.danger : effectiveColor};
        background: transparent;
        border: none;
        border-radius: 3px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        -webkit-app-region: no-drag;
        transition: background 0.1s, color 0.1s, border-color 0.1s;
      "
      on:mousedown|stopPropagation
      on:click|stopPropagation={onClose}
      on:mouseenter={() => (closeButtonHovered = true)}
      on:mouseleave={() => (closeButtonHovered = false)}
    >
      <CloseIcon width="9" height="9" />
    </button>
  {/if}
  {#if showLock}
    <!-- Lock chip: visual-only indicator that the workspace is locked.
         Renders in the same slot the close button would occupy so the
         row chrome stays consistent. Pointer events are disabled —
         the lock state is toggled from the context menu. -->
    <div
      aria-hidden="true"
      title="Workspace locked"
      style="
        position: absolute;
        top: 4px; left: 1px; right: 1px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: {effectiveColor};
        background: transparent;
        border: none;
        border-radius: 3px;
        pointer-events: none;
      "
    >
      <LockIcon width="9" height="9" />
    </div>
  {/if}
</div>

<style>
  .rail-bot-hat.pulses {
    animation: dg-rail-hat-glow 1.6s ease-in-out infinite;
  }

  @keyframes dg-rail-hat-glow {
    0%,
    100% {
      box-shadow: 0 0 0 0 transparent;
    }
    50% {
      box-shadow: 0 0 4px 1.5px
        color-mix(in srgb, var(--rail-hat-glow) 55%, transparent);
    }
  }
</style>
