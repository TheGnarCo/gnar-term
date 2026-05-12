<script lang="ts">
  import type { ThemeDef } from "../theme-data";
  import { shortcutHintsActive } from "../stores/shortcut-hints";
  import CloseIcon from "../icons/CloseIcon.svelte";
  import LockIcon from "../icons/LockIcon.svelte";
  import { variantColor } from "../status-colors";

  const warningColor = variantColor("warning");
  const successColor = variantColor("success");
  const mutedColor = variantColor("muted");

  export let theme: ThemeDef;
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
   * hover (or force-hover) state — so a colored frit is always shown on
   * the rail. The rail stripe is suppressed in this mode whenever the
   * dots are visible, to avoid painting two layers on top of each other.
   */
  export let alwaysShowDots: boolean = false;
  /**
   * When true, the dot pattern is masked with a left-to-right
   * gradient so the rail's right edge softens into the row content.
   * Default false — Branch rails opt in; root Workspace rails stay
   * unfaded so the pattern runs the full rail height cleanly.
   */
  export let fadeRight: boolean = false;
  /** When provided, renders a × chip at the top of the grip whenever the grip is in hover/force-hover state. */
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
   * Bot-status signal. Drives the rail "hat" (a 4–8px colored cap
   * at the top of the rail). Highest precedence first:
   *   - "attention":   yellow pulsing hat — at least one agent is
   *                    waiting on user input. Supersedes everything.
   *   - "thinking":    green static hat — at least one agent is
   *                    actively running/working but none waiting.
   *   - "idle":        muted-grey static hat — agent is attached
   *                    and "currently thinking" (idle / done /
   *                    detected-but-not-active). Lowest visual
   *                    weight, but still surfaces presence so the
   *                    bot's existence is never invisible.
   *   - "none":        no hat painted. Only when no agent is
   *                    detected at all.
   *
   * Renders in BOTH collapsed (narrowRail) and expanded sidebar
   * modes — bot status is the only universal signal we surface on
   * the rail itself, so it stays visible at every width.
   */
  export let botStatus: "none" | "thinking" | "attention" | "idle" = "none";
  /**
   * Whether the grip should respond to CSS `:hover` at all. False
   * suppresses hover effects when the row is locked or sidebar drag is
   * globally suspended — set by callers from their own gating logic.
   * Hover state is otherwise driven entirely by the CSS pseudo-class
   * on the grip element, so cursor exits that drop the synthetic
   * `mouseleave` (e.g., off the leftmost viewport edge) no longer
   * leave the rail stuck in a "hovered" state.
   */
  export let canHover: boolean = true;
  /**
   * Force the hover-state visual (dots, close button, grab cursor)
   * regardless of CSS `:hover`. Callers set this for drag-in-progress
   * so the rail stays in its expanded look while the pointer leaves
   * the grip.
   */
  export let forceHover: boolean = false;

  let closeButtonHovered = false;
  // shortcutLabel takes priority over close/lock when meta-hold is active.
  $: showShortcut = !!shortcutLabel && $shortcutHintsActive;
  $: hasClose = onClose != null && !locked && !showShortcut;
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
  // rail is hovered — so the stripe never hides, and the dot pattern
  // is gated out (it would otherwise paint 8px wide and contradict the
  // 4px policy).
  $: railStripeWidth = narrowRail ? "4px" : "8px";
  $: dotsRender = alwaysShowDots && !narrowRail;
  // Hat renders at every rail width — bot status is the one signal
  // we always surface on the rail itself so notification visibility
  // doesn't depend on whether the sidebar is collapsed.
  $: showHat = botStatus !== "none";
  $: hatColor =
    botStatus === "attention"
      ? warningColor
      : botStatus === "thinking"
        ? successColor
        : mutedColor;
  $: hatPulses = botStatus === "attention";
  // Hat matches the rail's painted width so it caps the rail cleanly
  // in both collapsed (4px) and expanded (8px) modes.
  $: hatWidth = railStripeWidth;
</script>

<!-- The grip is the rail's hover target. Hover state is `:hover`-driven
     so it stays accurate even when synthetic mouseenter/mouseleave
     events get dropped (cursor leaving the leftmost viewport edge,
     popovers stealing pointer events, etc.). `forceHover` lets callers
     paint the same state from outside (drag in progress). `canHover`
     gates hover entirely — when false, `:hover` is a no-op (locked
     grip, sidebar drag globally suspended). -->
<div
  aria-hidden="true"
  class="drag-grip"
  class:can-hover={canHover}
  class:force-hover={forceHover}
  class:locked
  class:primary-clickable={primaryClickable}
  class:narrow-rail={narrowRail}
  class:has-dots={dotsRender}
  class:has-shortcut={showShortcut}
  on:mousedown={onMouseDown ?? (() => {})}
>
  <!-- Rail stripe: always rendered. In expanded mode, CSS hides it
       while hovered (or force-hovered) and the dot pattern takes over;
       in narrow-rail mode the stripe stays visible regardless. -->
  <div
    class="rail-stripe"
    style="width: {railStripeWidth}; background: {effectiveColor}; opacity: {railOpacity};"
  ></div>

  {#if showHat}
    <!-- Bot-status hat overlay: a small rounded "cap" that protrudes
         4px above the row plus solid color inside the row. Width tracks
         the rail stripe (4px in collapsed mode, 8px in expanded) so the
         cap caps the rail cleanly without ever appearing thicker than
         the rail itself. In expanded mode the bottom 2px is a dark
         divider so the hat reads as a discrete chunk above the rail; in
         narrowRail mode the divider is dropped — at 4px width it reads
         as a broken seam between hat color and rail color rather than a
         visual separator. -->
    <div
      aria-hidden="true"
      class="rail-bot-hat"
      class:pulses={hatPulses}
      style="
        width: {hatWidth};
        --rail-hat-glow: {hatColor};
        background: {narrowRail
        ? hatColor
        : `linear-gradient(
          to bottom,
          ${hatColor} 0,
          ${hatColor} 14px,
          rgba(0, 0, 0, 0.55) 14px,
          rgba(0, 0, 0, 0.55) 16px
        )`};
      "
    ></div>
  {/if}

  {#if dotsRender}
    {@const fadeMask =
      "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)"}
    <!-- Frit dot pattern. Hidden by default; CSS reveals it when the
         grip is hovered (or force-hovered), at which point the stripe
         is hidden so only one rail layer paints at a time. Optional
         L→R fade (fadeRight prop) so the rail's right edge softens
         into the row content. -->
    <div
      class="rail-dots"
      style="
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
      class="grip-chip shortcut-chip"
      style="background: {theme.accent}; color: {theme.bg};"
    >
      {shortcutLabel}
    </div>
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
      class="grip-chip lock-chip"
      title="Workspace locked"
      style="color: {effectiveColor};"
    >
      <LockIcon width="9" height="9" />
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
  /* Expanded-mode hover: dots take over, stripe hides. Narrow-rail
     keeps the 4px stripe regardless of hover state. */
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

  .rail-bot-hat {
    position: absolute;
    left: 0;
    top: -4px;
    height: 16px;
    border-top-left-radius: 3px;
    border-top-right-radius: 3px;
    pointer-events: none;
    z-index: 3;
  }
  .rail-bot-hat.pulses {
    animation: dg-rail-hat-glow 1.6s ease-in-out infinite;
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
  }

  .shortcut-chip {
    font-size: 9px;
    font-weight: 700;
    pointer-events: none;
    white-space: nowrap;
  }

  .close-button {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    -webkit-app-region: no-drag;
    transition: color 0.1s;
    /* Hidden until the grip is hovered (or force-hovered). The
       `hasClose` render guard already factors in locked + shortcut
       state, so the only thing left to gate on is hover. */
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
