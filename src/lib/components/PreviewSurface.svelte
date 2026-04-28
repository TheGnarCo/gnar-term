<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { get } from "svelte/store";
  import { theme } from "../stores/theme";
  import type { PreviewSurface } from "../types";
  import { getAllPanes } from "../types";
  import { workspaces } from "../stores/workspace";
  import {
    openPreview,
    refreshPreviewElement,
  } from "../services/preview-service";
  import {
    registerPreviewSurface,
    unregisterPreviewSurface,
  } from "../services/preview-surface-registry";

  export let surface: PreviewSurface;
  export let visible: boolean;
  export let refreshTrigger: number = 0;

  let container: HTMLElement;
  let element: HTMLElement | null = null;
  let watchId = 0;
  let dispose: (() => void) | undefined;
  let loadError: string | null = null;
  let clickHandler: ((e: MouseEvent) => void) | undefined;

  function locate(): {
    workspaceId: string;
    paneId: string;
    hostMetadata?: Record<string, unknown>;
  } | null {
    for (const ws of get(workspaces)) {
      for (const pane of getAllPanes(ws.splitRoot)) {
        if (pane.surfaces.some((s) => s.id === surface.id)) {
          const hostMetadata = ws.metadata as
            | Record<string, unknown>
            | undefined;
          return {
            workspaceId: ws.id,
            paneId: pane.id,
            ...(hostMetadata ? { hostMetadata } : {}),
          };
        }
      }
    }
    return null;
  }

  onMount(async () => {
    const loc = locate();
    if (loc) {
      registerPreviewSurface({
        surfaceId: surface.id,
        path: surface.path,
        paneId: loc.paneId,
        workspaceId: loc.workspaceId,
        ...(loc.hostMetadata ? { hostMetadata: loc.hostMetadata } : {}),
      });
    }

    try {
      const result = await openPreview(surface.path, { surfaceId: surface.id });
      element = result.element;
      watchId = result.watchId;
      dispose = result.dispose;
      container.appendChild(element);

      clickHandler = (e: MouseEvent) => {
        const anchor = (e.target as Element).closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href?.startsWith("http://") && !href?.startsWith("https://"))
          return;
        e.preventDefault();
        invoke("open_url", { url: href }).catch(() => {});
      };
      container.addEventListener("click", clickHandler);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  });

  $: if (refreshTrigger > 0 && element) {
    void refreshPreviewElement(surface.path, element);
  }

  // Update preview colors when theme changes.
  $: if (element) {
    element.style.background = $theme.bg;
    element.style.color = $theme.fg;
  }

  onDestroy(() => {
    if (clickHandler) container?.removeEventListener("click", clickHandler);
    dispose?.();
    if (watchId > 0) {
      invoke("unwatch_file", { watchId }).catch(() => {});
    }
    unregisterPreviewSurface(surface.id);
  });
</script>

<div
  bind:this={container}
  data-preview-surface-id={surface.id}
  data-preview-surface-path={surface.path}
  style="
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    color: {$theme.fg};
    background: {$theme.bg};
    display: {visible ? 'flex' : 'none'};
    flex-direction: column;
  "
>
  {#if loadError}
    <div
      data-preview-surface-error
      style="
        padding: 24px 32px;
        font-family: monospace;
        font-size: 13px;
        white-space: pre-wrap;
        color: {$theme.danger};
      "
    >
      {loadError}
    </div>
  {/if}
</div>
