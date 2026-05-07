<script lang="ts">
  import { theme } from "../stores/theme";
  import CloseIcon from "../icons/CloseIcon.svelte";

  export let size: "tab" | "container" = "tab";
  export let label: string = "Close";
  export let visible: boolean = true;

  let hovered = false;
  $: dim = size === "tab" ? 12 : 14;
  $: iconDim = size === "tab" ? "7" : "9";
</script>

<button
  aria-label={label}
  title={label}
  on:click|stopPropagation
  on:mouseenter={() => (hovered = true)}
  on:mouseleave={() => (hovered = false)}
  style="
    display: flex; align-items: center; justify-content: center;
    width: {dim}px; height: {dim}px; flex-shrink: 0;
    color: {hovered ? $theme.danger : $theme.fgDim};
    background: transparent; border: none; border-radius: 3px;
    cursor: pointer; padding: 0; line-height: 1;
    transition: color 0.1s;
    visibility: {visible ? 'visible' : 'hidden'};
    -webkit-app-region: no-drag;
  "
>
  <CloseIcon width={iconDim} height={iconDim} />
</button>
