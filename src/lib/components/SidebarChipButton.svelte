<script lang="ts">
  /**
   * SidebarChipButton — small 14×14 close/lock/settings button used in
   * the primary sidebar (child workspace rows, workspace banners).
   * Encapsulates the shared idle/hover color logic and stopPropagation
   * wiring.
   */
  import { theme } from "../stores/theme";
  import CloseIcon from "../icons/CloseIcon.svelte";
  import LockIcon from "../icons/LockIcon.svelte";
  import GearIcon from "../icons/GearIcon.svelte";

  export let variant: "close" | "lock" | "settings";
  export let title: string;
  /** Idle color. Defaults to theme.fgDim. */
  export let idleColor: string | undefined = undefined;
  export let onClick: (() => void) | undefined = undefined;

  let hovered = false;

  $: idle = idleColor ?? $theme.fgDim;
  $: hoverColor = variant === "close" ? $theme.danger : $theme.fg;
</script>

<button
  {title}
  aria-label={title}
  style="
    display: flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; flex-shrink: 0;
    color: {hovered ? hoverColor : idle};
    background: transparent;
    border: none;
    border-radius: 3px; cursor: pointer; padding: 0;
    line-height: 1;
    transition: color 0.1s, border-color 0.1s;
    -webkit-app-region: no-drag;
  "
  on:mousedown|stopPropagation
  on:click|stopPropagation={onClick}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => (hovered = false)}
>
  {#if variant === "lock"}
    <LockIcon width="9" height="9" />
  {:else if variant === "settings"}
    <GearIcon size={10} />
  {:else}
    <CloseIcon width="9" height="9" />
  {/if}
</button>
