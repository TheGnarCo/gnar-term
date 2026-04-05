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
    forwardIframeKeys(surface.element);
  });

  function forwardIframeKeys(el: HTMLElement) {
    const observer = new MutationObserver(() => {
      for (const iframe of el.querySelectorAll("iframe")) {
        try {
          iframe.contentWindow?.addEventListener("keydown", (e: KeyboardEvent) => {
            window.dispatchEvent(new KeyboardEvent("keydown", {
              key: e.key, code: e.code, metaKey: e.metaKey,
              ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
            }));
          });
        } catch {}
      }
    });
    observer.observe(el, { childList: true, subtree: true });
    // Check for iframes already present
    for (const iframe of el.querySelectorAll("iframe")) {
      iframe.addEventListener("load", () => {
        try {
          iframe.contentWindow?.addEventListener("keydown", (e: KeyboardEvent) => {
            window.dispatchEvent(new KeyboardEvent("keydown", {
              key: e.key, code: e.code, metaKey: e.metaKey,
              ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
            }));
          });
        } catch {}
      });
    }
  }

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
