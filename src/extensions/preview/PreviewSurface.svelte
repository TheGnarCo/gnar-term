<script lang="ts">
  import { onMount, onDestroy, getContext } from "svelte";
  import {
    EXTENSION_API_KEY,
    type ExtensionAPI,
    type ExtensionSurfacePayload,
  } from "../api";
  import { openPreview, renderContentToElement } from "./preview-service";

  export let surface: ExtensionSurfacePayload;
  export let visible: boolean;

  const api = getContext<ExtensionAPI>(EXTENSION_API_KEY);
  const theme = api.theme;

  let container: HTMLElement;

  $: element = surface.props?.element as HTMLElement | undefined;
  $: watchId = (surface.props?.watchId as number) || 0;

  onMount(async () => {
    // Three content sources, in priority order:
    //   1. pre-built element (file-based preview created eagerly)
    //   2. filePath (file-based; render lazily on mount)
    //   3. content + format (in-memory; e.g. MCP open_surface)
    if (!element && surface.props?.filePath) {
      const preview = await openPreview(surface.props.filePath as string, api);
      surface.props = {
        ...surface.props,
        element: preview.element,
        watchId: preview.watchId,
      };
      element = preview.element;
      watchId = preview.watchId;
    } else if (!element && typeof surface.props?.content === "string") {
      const format =
        (surface.props.format as "markdown" | "text" | "code") ?? "markdown";
      const language = (surface.props.language as string | undefined) ?? "";
      element = renderContentToElement(
        surface.props.content as string,
        format,
        language,
        api,
      );
      surface.props = { ...surface.props, element };
    }
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
