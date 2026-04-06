<script lang="ts">
  import { onMount, tick } from "svelte";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { invoke } from "@tauri-apps/api/core";
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

      try { surface.fitAddon.fit(); } catch (e) { console.warn("fitAddon.fit() failed on mount:", e); }
      await connectPty(surface, cwd);

      // Send startup command after PTY is connected (not on a timer)
      if (surface.startupCommand && surface.ptyId >= 0) {
        invoke("write_pty", { ptyId: surface.ptyId, data: `${surface.startupCommand}\n` }).catch((e) =>
          console.warn("Failed to send startup command:", e)
        );
        surface.startupCommand = undefined;
      }

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
      try { surface.fitAddon.fit(); } catch (e) { console.warn("fitAddon.fit() failed on visibility change:", e); }
    });
  }
</script>

<div
  bind:this={termEl}
  style="flex: 1; min-height: 0; min-width: 0; overflow: hidden; display: {visible ? 'flex' : 'none'}; flex-direction: column;"
></div>
