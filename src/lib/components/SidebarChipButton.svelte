<script lang="ts">
  /**
   * SidebarChipButton — small close/lock affordance used in sidebar rows
   * and anchor rows. Encapsulates the shared idle/hover color logic and
   * stopPropagation wiring. Uses the project's `×` close glyph (no icon
   * components on the stack-top) so it matches Tab / WorkspaceItem chrome.
   */
  import { theme } from "../stores/theme";

  export let variant: "close" | "lock";
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
    font-size: 14px; line-height: 1;
    transition: color 0.1s;
    -webkit-app-region: no-drag;
  "
  on:mousedown|stopPropagation
  on:click|stopPropagation={onClick}
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => (hovered = false)}
>
  {#if variant === "lock"}🔒{:else}×{/if}
</button>
