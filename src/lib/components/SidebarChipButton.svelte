<script lang="ts">
  /**
   * SidebarChipButton — small 14×14 close/lock button used in the
   * primary sidebar (workspace rows, group banners). Encapsulates the
   * shared idle/hover color logic and stopPropagation wiring.
   */
  import { theme } from "../stores/theme";
  import CloseIcon from "../icons/CloseIcon.svelte";
  import LockIcon from "../icons/LockIcon.svelte";

  export let variant: "close" | "lock";
  export let title: string;
  /** Idle color. Defaults to theme.fgDim. */
  export let idleColor: string | undefined = undefined;
  export let onClick: (() => void) | undefined = undefined;

  let hovered = false;

  $: idle = idleColor ?? $theme.fgDim;
  $: hoverColor = variant === "lock" ? $theme.fg : $theme.danger;
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
  {:else}
    <CloseIcon width="9" height="9" />
  {/if}
</button>
