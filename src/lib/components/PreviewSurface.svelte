<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { theme } from "../stores/theme";
  import type { PreviewSurface as PreviewSurfaceType } from "../types";

  export let surface: PreviewSurfaceType;
  export let visible: boolean;

  let container: HTMLElement;

  onMount(() => {
    container.appendChild(surface.element);
  });

  // Update preview colors when theme changes
  $: if (surface.element) {
    surface.element.style.background = $theme.bg;
    surface.element.style.color = $theme.fg;
  }

  onDestroy(() => {
    if (surface.watchId > 0) {
      invoke("unwatch_file", { watchId: surface.watchId }).catch(() => {});
    }
    surface.dispose?.();
  });
</script>

<div
  bind:this={container}
  style="flex: 1; min-height: 0; overflow-y: auto; display: {visible ? 'flex' : 'none'}; flex-direction: column;"
></div>
