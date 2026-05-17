<script lang="ts">
  /**
   * AlacrittyTerminalSurface.svelte
   *
   * Self-contained canvas-2d terminal surface backed by the Alacritty engine.
   * This component is intentionally NOT wired into the existing pane creation
   * flow — cycle-6 handles the feature-flag integration.
   *
   * Key responsibilities:
   *   - Mount a <canvas> and size it to cols × rows in cell units.
   *   - On mount: attach to the engine via `invoke('attach_alacritty_engine', …)`.
   *   - Subscribe to the Tauri channel; apply snapshot + diff messages.
   *   - Encode keydown events to PTY byte sequences and forward via
   *     `invoke('write_pty', …)`.
   *   - On destroy: detach from the engine.
   *
   * Keyboard handling (Phase 2 / cycle-12):
   *   Covers printable ASCII, Enter, Backspace, Tab, arrow keys, F1–F12,
   *   Home/End/PageUp/PageDown/Insert/Delete, Ctrl+letter combos, Alt-prefix,
   *   and modifier-encoded sequences (Ctrl+arrow, Shift+arrow, etc.).
   *
   * Wave-A integration (cycle-21):
   *   - search-bridge: attachSearch for FindBar rewire.
   *   - mouse-handler: attachMouse for selection IPC.
   *   - link-overlay: attachLinkOverlay for URL/path hover+click.
   *   - paste-handler: PasteHandler for bracketed paste encoding.
   *   - scroll-anchor: ScrollAnchor for viewport preservation during writes.
   *   - theme-bridge: attachThemeBridge for live palette updates.
   *   - cell-metrics: cellMetrics.subscribe for font/DPR change reactions.
   */

  import { onMount, onDestroy } from "svelte";
  import { invoke, Channel } from "@tauri-apps/api/core";
  import { Renderer } from "./alacritty-renderer";
  import { encodeKey } from "./alacritty-key-encoder";
  import type {
    TerminalChannelMessage,
    GridSnapshot,
  } from "../types/terminal-ipc";

  // ─── Wave-A imports ─────────────────────────────────────────────────────────

  import { attachSearch } from "./alacritty/search-bridge";
  import type { SearchHandle } from "./alacritty/search-bridge";
  import { attachMouse } from "./alacritty/mouse-handler";
  import type { MouseHandle } from "./alacritty/mouse-handler";
  import { attachLinkOverlay } from "./alacritty/link-overlay";
  import type { LinkOverlayHandle } from "./alacritty/link-overlay";
  import { PasteHandler } from "./alacritty/paste-handler";
  import { ScrollAnchor } from "./alacritty/scroll-anchor";
  import { attachThemeBridge } from "./alacritty/theme-bridge";
  import type { ThemeBridgeHandle, Palette } from "./alacritty/theme-bridge";
  import { cellMetrics } from "./alacritty/cell-metrics";
  import { readText as clipboardRead } from "@tauri-apps/plugin-clipboard-manager";

  // ─── Props ─────────────────────────────────────────────────────────────────

  export let ptyId: number;
  export let paneId: string = "";
  export let fontSize: number = 14;
  export let fontFamily: string = "monospace";

  // Expose search handle so FindBar.svelte (or any parent) can call
  // findNext / findPrev / clear without reaching into internal state.
  export let searchHandle: SearchHandle | undefined = undefined;

  // ─── Internal state ────────────────────────────────────────────────────────

  let canvasEl: HTMLCanvasElement;
  let renderer: Renderer | undefined;
  let channel: Channel<TerminalChannelMessage> | undefined;
  let resizeObserver: ResizeObserver | undefined;

  /**
   * Track current grid dimensions so we can detect resizes in diffs.
   * On resize (diff rows/cols differ from snapshot), we need a fresh snapshot.
   */
  let currentCols = 80;
  let currentRows = 24;
  let cellWidth = 8;
  let cellHeight = 16.8;

  // Current grid snapshot — needed by link-overlay's getGrid() accessor.
  let currentGrid: GridSnapshot | null = null;

  // Current palette — updated by theme-bridge, applied to new Renderer instances.
  let currentPalette: Palette = {};

  // Wave-A handles (teardown in onDestroy)
  let mouseHandle: MouseHandle | undefined;
  let linkHandle: LinkOverlayHandle | undefined;
  let themeBridgeHandle: ThemeBridgeHandle | undefined;
  let metricsUnsub: (() => void) | undefined;

  // Wave-A stateful objects (per-surface)
  const pasteHandler = new PasteHandler();
  const scrollAnchor = new ScrollAnchor();

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(async () => {
    const ctx = canvasEl.getContext("2d");
    if (!ctx) {
      console.error("[AlacrittyTerminalSurface] canvas 2d context unavailable");
      return;
    }

    // Measure cell dimensions using the chosen font.
    ctx.font = `${fontSize}px ${fontFamily}`;
    // Set textBaseline to "top" so fillText y-coordinates align to the cell
    // top edge (row * cellHeight). The canvas default is "alphabetic" baseline,
    // which would shift glyphs upward by the font's ascender height and cause
    // off-by-one rendering relative to background fillRects.
    ctx.textBaseline = "top";
    cellWidth = ctx.measureText("M").width;
    cellHeight = fontSize * 1.2;

    // Size canvas to default grid dimensions; will be resized on first snapshot.
    canvasEl.width = currentCols * cellWidth;
    canvasEl.height = currentRows * cellHeight;

    renderer = new Renderer({
      ctx,
      fontFamily,
      fontSize,
      cellWidth,
      cellHeight,
      palette: currentPalette,
    });

    // ─── theme-bridge ──────────────────────────────────────────────────────
    // Fires once immediately on attach with the current palette, then on each
    // theme change. Palette updates require constructing a new Renderer because
    // Renderer.palette is immutable after construction.
    themeBridgeHandle = attachThemeBridge({
      onPaletteChanged: (palette) => {
        currentPalette = palette;
        // If we already have a renderer context, rebuild it with the new palette.
        // The renderer constructor restores ctx state (font, textBaseline).
        if (ctx) {
          renderer = new Renderer({
            ctx,
            fontFamily,
            fontSize,
            cellWidth,
            cellHeight,
            palette: currentPalette,
          });
        }
      },
      onRenderRequested: () => {
        // Repaint with the last known grid if we have one.
        if (renderer && currentGrid) {
          renderer.paintSnapshot(currentGrid);
        }
      },
    });

    // ─── cell-metrics ─────────────────────────────────────────────────────
    // Fires immediately with current dimensions, then again on font-size store
    // changes or DPR changes. Update cellWidth/cellHeight and rebuild renderer.
    metricsUnsub = cellMetrics.subscribe(
      ({ cellWidth: cw, cellHeight: ch }) => {
        if (cw === cellWidth && ch === cellHeight) return;
        cellWidth = cw;
        cellHeight = ch;
        // Resize canvas to match new cell dimensions, then rebuild renderer.
        const newW = currentCols * cellWidth;
        const newH = currentRows * cellHeight;
        if (newW > 0 && newH > 0) {
          canvasEl.width = newW;
          canvasEl.height = newH;
          ctx.textBaseline = "top";
          ctx.font = `${fontSize}px ${fontFamily}`;
          renderer = new Renderer({
            ctx,
            fontFamily,
            fontSize,
            cellWidth,
            cellHeight,
            palette: currentPalette,
          });
          if (currentGrid) renderer.paintSnapshot(currentGrid);
          // Notify engine of the new cell-driven terminal dimensions.
          invoke("resize_alacritty_engine", {
            ptyId,
            cols: currentCols,
            rows: currentRows,
          }).catch((err) => {
            console.error(
              "[AlacrittyTerminalSurface] resize_alacritty_engine (cell-metrics) failed:",
              err,
            );
          });
        }
      },
      fontFamily,
    );

    // Wire canvas resize → engine resize so the Alacritty engine stays in sync
    // with the actual canvas dimensions. On resize, recalculate cols × rows and
    // invoke resize_alacritty_engine, which reflows the engine and emits a fresh
    // Snapshot (see AlacrittyTerminalSurface comment on snapshot-on-resize).
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const newCols = Math.max(1, Math.floor(width / cellWidth));
          const newRows = Math.max(1, Math.floor(height / cellHeight));
          if (newCols !== currentCols || newRows !== currentRows) {
            currentCols = newCols;
            currentRows = newRows;
            canvasEl.width = newCols * cellWidth;
            canvasEl.height = newRows * cellHeight;
            // Canvas dimension assignment resets ctx state (HTML spec
            // §4.12.5.1). Restore textBaseline so subsequent paints from
            // the existing renderer keep glyph alignment.
            ctx.textBaseline = "top";
            ctx.font = `${fontSize}px ${fontFamily}`;
            invoke("resize_alacritty_engine", {
              ptyId,
              cols: newCols,
              rows: newRows,
            }).catch((err) => {
              console.error(
                "[AlacrittyTerminalSurface] resize_alacritty_engine failed:",
                err,
              );
            });
          }
        }
      }
    });
    resizeObserver.observe(canvasEl);

    channel = new Channel<TerminalChannelMessage>();

    channel.onmessage = (msg) => {
      if (!renderer) return;
      if (msg.kind === "snapshot") {
        const snap = msg.value as GridSnapshot;
        currentCols = snap.cols;
        currentRows = snap.rows;
        currentGrid = snap;
        // Resize the canvas FIRST, then construct the Renderer. Canvas
        // dimension assignment resets ctx state (HTML spec §4.12.5.1),
        // so any Renderer constructed before this would have its
        // textBaseline / font wiped. Constructing after the resize lets
        // the constructor's ctx setup be the last write before paint.
        canvasEl.width = snap.cols * cellWidth;
        canvasEl.height = snap.rows * cellHeight;
        renderer = new Renderer({
          ctx,
          fontFamily,
          fontSize,
          cellWidth,
          cellHeight,
          palette: currentPalette,
        });
        renderer.paintSnapshot(snap);
      } else {
        // diff
        const diff = msg.value;
        if (diff.rows !== currentRows || diff.cols !== currentCols) {
          // The diff's grid dimensions differ from our current canvas dimensions.
          // Painting with stale dimensions would corrupt the display — skip this
          // diff and trigger a fresh snapshot by re-requesting the engine resize
          // so we re-sync on the next message.
          console.error(
            "[AlacrittyTerminalSurface] grid resize mismatch in diff " +
              `(got ${diff.cols}x${diff.rows}, expected ${currentCols}x${currentRows}); ` +
              "skipping paintDiff and requesting fresh snapshot.",
          );
          // Re-sync: ask the engine to emit a fresh Snapshot at the current
          // canvas dimensions so the renderer can repaint from scratch.
          invoke("resize_alacritty_engine", {
            ptyId,
            cols: currentCols,
            rows: currentRows,
          }).catch((err) => {
            console.error(
              "[AlacrittyTerminalSurface] resize_alacritty_engine failed during re-sync:",
              err,
            );
          });
          // Do NOT call paintDiff with stale dimensions.
          return;
        }
        renderer.paintDiff(diff);
        renderer.paintCursor(diff.cursor);
        // Notify scroll anchor that new content arrived.
        scrollAnchor.onNewContent();
      }
    };

    try {
      await invoke("attach_alacritty_engine", { ptyId, channel });
    } catch (err) {
      // attach_alacritty_engine failed — this is unexpected and means the
      // component will not receive any terminal data. Log as error.
      console.error(
        "[AlacrittyTerminalSurface] attach_alacritty_engine failed:",
        err,
      );
    }

    // ─── mouse-handler ────────────────────────────────────────────────────
    // Translates DOM mouse events to selection IPC calls.
    mouseHandle = attachMouse(canvasEl, {
      cell_width: cellWidth,
      cell_height: cellHeight,
      paneId: paneId || String(ptyId),
    });

    // ─── link-overlay ─────────────────────────────────────────────────────
    // Hover detection + modifier-click to open URLs/paths.
    linkHandle = attachLinkOverlay(canvasEl, {
      cellWidth,
      cellHeight,
      getGrid: () => currentGrid,
      onDecorate: (match) => {
        // Update cursor style to indicate link presence.
        canvasEl.style.cursor = match ? "pointer" : "";
      },
    });

    // ─── search handle ────────────────────────────────────────────────────
    // Bind search handle so FindBar.svelte can invoke search commands.
    searchHandle = attachSearch(paneId || String(ptyId));

    // ─── paste handler (clipboard) ────────────────────────────────────────
    // Wire the paste event so clipboard text is encoded correctly.
    canvasEl.addEventListener("paste", handlePaste);

    canvasEl.focus();
  });

  onDestroy(() => {
    // Stop observing canvas resize events.
    resizeObserver?.disconnect();
    resizeObserver = undefined;

    // Tear down Wave-A handles.
    mouseHandle?.detach();
    mouseHandle = undefined;

    linkHandle?.detach();
    linkHandle = undefined;

    themeBridgeHandle?.detach();
    themeBridgeHandle = undefined;

    metricsUnsub?.();
    metricsUnsub = undefined;

    canvasEl?.removeEventListener("paste", handlePaste);

    // Detach the Alacritty engine bridge, releasing backend memory.
    if (ptyId >= 0) {
      invoke("detach_alacritty_engine", { ptyId }).catch((err) => {
        console.error(
          "[AlacrittyTerminalSurface] detach_alacritty_engine failed:",
          err,
        );
      });
    }
    channel = undefined;
    renderer = undefined;
    currentGrid = null;
    searchHandle = undefined;
  });

  // ─── Keyboard handling ─────────────────────────────────────────────────────
  // encodeKey is imported from alacritty-key-encoder.ts for testability.

  function handleKeydown(e: KeyboardEvent): void {
    const data = encodeKey(e);
    if (data === null) return;
    e.preventDefault();
    // Match existing xterm.js convention: invoke('write_pty', { ptyId, data })
    invoke("write_pty", { ptyId, data }).catch((err) => {
      console.error("[AlacrittyTerminalSurface] write_pty failed:", err);
    });
  }

  // ─── Paste handling ─────────────────────────────────────────────────────────
  // Use PasteHandler to bracket-wrap when enabled, then write to PTY.

  function handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain");
    if (text && ptyId >= 0) {
      const encoded = pasteHandler.encodePaste(text);
      invoke("write_pty", { ptyId, data: encoded }).catch((err) => {
        console.error(
          "[AlacrittyTerminalSurface] write_pty (paste) failed:",
          err,
        );
      });
    }
  }

  // ─── Scroll handling ──────────────────────────────────────────────────────
  // ScrollAnchor: track user scroll offset.

  function handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const rowDelta =
      Math.sign(e.deltaY) *
      Math.max(1, Math.round(Math.abs(e.deltaY) / cellHeight));
    const newOffset = Math.max(0, scrollAnchor.currentOffset + rowDelta);
    scrollAnchor.onUserScroll(newOffset);
  }

  // ─── Context menu (paste via clipboard read) ─────────────────────────────

  function handleContextMenu(e: MouseEvent): void {
    // Suppress default context menu; a future cycle may add a rich menu.
    e.preventDefault();
    void clipboardRead()
      .then((text) => {
        if (text && ptyId >= 0) {
          const encoded = pasteHandler.encodePaste(text);
          invoke("write_pty", { ptyId, data: encoded }).catch((err) => {
            console.error(
              "[AlacrittyTerminalSurface] write_pty (ctx paste) failed:",
              err,
            );
          });
        }
      })
      .catch(() => {});
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<canvas
  bind:this={canvasEl}
  tabindex="0"
  role="textbox"
  aria-label="Terminal"
  data-pty-id={ptyId}
  style="display: block; outline: none;"
  on:keydown={handleKeydown}
  on:wheel|passive={handleWheel}
  on:contextmenu={handleContextMenu}
></canvas>
