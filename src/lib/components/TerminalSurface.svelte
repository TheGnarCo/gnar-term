<script lang="ts">
  import { onMount } from "svelte";
  import { WebglAddon } from "@xterm/addon-webgl";
  import type { TerminalSurface as TermSurface } from "../types";

  export let surface: TermSurface;
  export let visible: boolean;

  let termEl: HTMLElement;

  onMount(() => {
    // Always mount via surface.termElement so that context menu listeners
    // (attached in terminal-service.ts) fire on the correct DOM element.
    termEl.appendChild(surface.termElement);

    if (!surface.opened) {
      surface.terminal.open(surface.termElement);
      try { surface.fitAddon.fit(); } catch {}

      const initWebGL = () => {
        try {
          const addon = new WebglAddon();
          addon.onContextLoss(() => setTimeout(initWebGL, 100));
          surface.terminal.loadAddon(addon);
        } catch (e) {
          console.warn("WebGL renderer failed, using DOM renderer", e);
        }
      };
      setTimeout(initWebGL, 50);
      surface.opened = true;
    }
    // Re-mount case: termElement already has the terminal canvas inside it,
    // so appending it above is sufficient — no need to re-open.
  });

  // NOTE: No onDestroy cleanup here. Terminal lifecycle (dispose, kill_pty) is
  // owned by App.svelte which handles cleanup BEFORE triggering the unmount.

  // fit() is handled solely by PaneView's ResizeObserver, which fires on:
  // - pane split (container width changes)
  // - window resize
  // - workspace switch (display: none → flex triggers size change)
  // A reactive fit() here would race with the ResizeObserver and calculate
  // dimensions before flex layout settles, causing wrong terminal sizing.
</script>

<div
  bind:this={termEl}
  style="flex: 1; min-height: 0; min-width: 0; overflow: hidden; display: {visible ? 'flex' : 'none'};"
></div>
