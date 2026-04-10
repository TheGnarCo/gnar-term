<script lang="ts">
  import { onMount, onDestroy, getContext } from "svelte";
  import { EXTENSION_API_KEY, type ExtensionAPI } from "../extension-types";
  import type { ExtensionSurface } from "../types";

  export let surface: ExtensionSurface;
  export let visible: boolean;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let container: HTMLElement;

  $: element = surface.props?.element as HTMLElement | undefined;
  $: watchId = (surface.props?.watchId as number) || 0;

  onMount(() => {
    if (element) container.appendChild(element);
  });

  // Update preview colors when theme changes
  $: if (element) {
    element.style.background = $theme.bg;
    element.style.color = $theme.fg;
  }

  onDestroy(() => {
    if (watchId > 0) {
      api.invoke("unwatch_file", { watchId }).catch(() => {});
    }
    surface.dispose?.();
  });
</script>

<div
  bind:this={container}
  style="flex: 1; min-height: 0; overflow-y: auto; display: {visible
    ? 'flex'
    : 'none'}; flex-direction: column;"
></div>
