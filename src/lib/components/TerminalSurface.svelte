<script lang="ts">
  import { onMount, tick } from "svelte";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { connectPty } from "../terminal-service";
  import type { TerminalSurface as TermSurface } from "../types";

  export let surface: TermSurface;
  export let visible: boolean;
  export let cwd: string | undefined = undefined;

  let termEl: HTMLElement;

  onMount(async () => {
    termEl.appendChild(surface.termElement);

    if (!surface.opened) {
      surface.terminal.open(surface.termElement);

      await tick();
      await new Promise(r => requestAnimationFrame(r));

      try { surface.fitAddon.fit(); } catch {}
      await connectPty(surface, cwd);

      const initWebGL = () => {
        try {
          const addon = new WebglAddon();
          addon.onContextLoss(() => setTimeout(initWebGL, 100));
          surface.terminal.loadAddon(addon);
        } catch (e) {
          console.warn("WebGL renderer failed, using DOM renderer", e);
        }
      };
      requestAnimationFrame(initWebGL);
      surface.opened = true;
    }
  });

  $: if (visible && surface.opened && termEl) {
    requestAnimationFrame(() => {
      try { surface.fitAddon.fit(); } catch {}
    });
  }
</script>

<div
  bind:this={termEl}
  style="flex: 1; min-height: 0; min-width: 0; overflow: hidden; display: {visible ? 'flex' : 'none'}; flex-direction: column;"
></div>
