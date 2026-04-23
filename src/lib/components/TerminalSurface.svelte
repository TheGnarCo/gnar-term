<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { WebglAddon } from "@xterm/addon-webgl";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
  import { connectPty } from "../terminal-service";
  import { theme } from "../stores/theme";
  import type { TerminalSurface as TermSurface } from "../types";

  export let surface: TermSurface;
  export let visible: boolean;
  export let cwd: string | undefined = undefined;

  let termEl: HTMLElement;
  let dragOver = false;
  let unlistenDragDrop: (() => void) | undefined;
  export let userScrolledUp = false;
  let scrollDisposable: { dispose(): void } | undefined;

  const IMAGE_EXTS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "svg",
    "tiff",
    "ico",
    "avif",
  ]);

  function isImageFile(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTS.has(ext);
  }

  /** Shell-escape a file path by wrapping in single quotes. */
  function shellEscape(path: string): string {
    return "'" + path.replace(/'/g, "'\\''") + "'";
  }

  async function handleDropPaths(paths: string[]): Promise<void> {
    if (!paths.length || surface.ptyId < 0) return;

    const imagePaths: string[] = [];
    const textParts: string[] = [];

    for (const path of paths) {
      if (isImageFile(path)) {
        imagePaths.push(path);
      } else {
        textParts.push(shellEscape(path));
      }
    }

    if (imagePaths.length > 0) {
      writeImage(imagePaths[0]!).catch((e) =>
        console.warn("Failed to write image to clipboard:", e),
      );
    }

    if (textParts.length > 0) {
      void invoke("write_pty", {
        ptyId: surface.ptyId,
        data: textParts.join(" ") + " ",
      });
    } else if (imagePaths.length > 0) {
      // Image is now in clipboard; send Ctrl+V so the terminal app
      // reads it. Claude Code CLI interprets \x16 as a clipboard paste
      // and shows [Image 1], matching manual Ctrl+V behavior.
      void invoke("write_pty", { ptyId: surface.ptyId, data: "\x16" });
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0 || surface.ptyId < 0) return;
    const paths = Array.from(files).map(
      (f) => (f as unknown as { path?: string }).path || f.name,
    );
    void handleDropPaths(paths);
  }

  function registerScrollTracking() {
    scrollDisposable?.dispose();
    scrollDisposable = surface.terminal.onScroll((newScrollPos: number) => {
      const maxScroll = Math.max(
        0,
        surface.terminal.buffer.active.length - surface.terminal.rows,
      );
      userScrolledUp = newScrollPos < maxScroll;
    });
  }

  onMount(async () => {
    termEl.appendChild(surface.termElement);

    if (!surface.opened) {
      surface.terminal.open(surface.termElement);

      await tick();
      await new Promise((r) => requestAnimationFrame(r));

      try {
        surface.fitAddon.fit();
      } catch (e) {
        console.warn("fitAddon.fit() failed on mount:", e);
      }
      await connectPty(surface, cwd, surface.env);

      // Send startup command after PTY is connected (not on a timer)
      if (surface.startupCommand && surface.ptyId >= 0) {
        invoke("write_pty", {
          ptyId: surface.ptyId,
          data: `${surface.startupCommand}\n`,
        }).catch((e) => console.warn("Failed to send startup command:", e));
        surface.startupCommand = undefined;
      }

      // WebGL contexts are capped by the webview (WKWebView ~16). Under a
      // burst of spawned panes, exceeding the cap evicts existing contexts
      // and fires onContextLoss; an unbounded retry cascade wedges the
      // compositor and freezes the app. Cap retries and fall back to the
      // DOM renderer, which is slower but stable.
      let webglAttempts = 0;
      const MAX_WEBGL_ATTEMPTS = 3;
      const initWebGL = () => {
        if (webglAttempts >= MAX_WEBGL_ATTEMPTS) return;
        webglAttempts++;
        try {
          const addon = new WebglAddon();
          addon.onContextLoss(() => {
            if (webglAttempts < MAX_WEBGL_ATTEMPTS) {
              setTimeout(initWebGL, 100);
            }
          });
          surface.terminal.loadAddon(addon);
        } catch (e) {
          console.warn("WebGL renderer failed, using DOM renderer", e);
        }
      };
      requestAnimationFrame(initWebGL);
      surface.opened = true;
    }

    registerScrollTracking();

    // Tauri native file drop (more reliable than HTML5 on Linux WebKitGTK)
    unlistenDragDrop = await listen<{
      paths: string[];
      position: { x: number; y: number };
    }>("tauri://drag-drop", (event) => {
      if (!visible || surface.ptyId < 0) return;
      void handleDropPaths(event.payload.paths);
    });
  });

  onDestroy(() => {
    unlistenDragDrop?.();
    scrollDisposable?.dispose();
  });

  $: if (visible && surface.opened && termEl) {
    requestAnimationFrame(() => {
      try {
        surface.fitAddon.fit();
        surface.terminal.scrollToBottom();
        userScrolledUp = false;
      } catch (e) {
        console.warn("fitAddon.fit() failed on visibility change:", e);
      }
    });
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  bind:this={termEl}
  data-scrolled-up={userScrolledUp || undefined}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
  style="position: relative; flex: 1; min-height: 0; min-width: 0; overflow: hidden; display: {visible
    ? 'flex'
    : 'none'}; flex-direction: column; {dragOver
    ? `box-shadow: inset 0 0 0 2px ${$theme.accent}; border-radius: 4px;`
    : ''}"
></div>
