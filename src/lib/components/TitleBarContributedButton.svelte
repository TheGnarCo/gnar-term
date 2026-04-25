<script lang="ts">
  import { readable } from "svelte/store";
  import type { Component } from "svelte";
  import type { TitleBarButton } from "../services/titlebar-button-registry";

  export let button: TitleBarButton;
  export let btnStyle: string;
  export let fg: string;
  export let fgActive: string;

  $: activeStore = button.isActive ?? readable(false);
  $: icon = button.icon as Component;
</script>

<button
  style="{btnStyle} color: {$activeStore ? fgActive : fg};"
  title={button.title}
  aria-label={button.title}
  on:click={button.onClick}
>
  <svelte:component this={icon} width={16} height={16} />
</button>
