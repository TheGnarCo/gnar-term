<script lang="ts">
  import type { ThemeDef } from "../theme-data";

  export let title: string;
  export let onClick: () => void;
  export let theme: ThemeDef;
  export let svgContent: string;
</script>

<button
  {title}
  on:click={onClick}
  style="
    background: transparent;
    color: {theme.fgDim};
    border: none;
    padding: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    border-radius: 4px;
    -webkit-app-region: no-drag;
  "
  on:mouseenter={(e) => {
    const el = e.currentTarget;
    if (el instanceof HTMLElement) {
      el.style.background = theme.bgHighlight;
      el.style.color = theme.fg;
    }
  }}
  on:mouseleave={(e) => {
    const el = e.currentTarget;
    if (el instanceof HTMLElement) {
      el.style.background = "transparent";
      el.style.color = theme.fgDim;
    }
  }}
>
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {@html svgContent}
  </svg>
</button>
