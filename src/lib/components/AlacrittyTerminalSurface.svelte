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
   * Keyboard handling (Phase 1 / cycle-5):
   *   Covers printable ASCII, Enter, Backspace, Tab, and arrow keys.
   *   Fuller key handling (F-keys, Ctrl sequences, alt-codes, modifier combos)
   *   is cycle-7 / Phase 2 work — flagged with TODO below.
   */

  import { onMount, onDestroy } from "svelte";
  import { invoke, Channel } from "@tauri-apps/api/core";
  import { Renderer } from "./alacritty-renderer";
  import { encodeKey } from "./alacritty-key-encoder";
  import type {
    TerminalChannelMessage,
    GridSnapshot,
  } from "../types/terminal-ipc";

  // ─── Props ─────────────────────────────────────────────────────────────────

  export let ptyId: number;
  export let fontSize: number = 14;
  export let fontFamily: string = "monospace";

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
    });

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

    canvasEl.focus();
  });

  onDestroy(() => {
    // Stop observing canvas resize events.
    resizeObserver?.disconnect();
    resizeObserver = undefined;

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
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<canvas
  bind:this={canvasEl}
  tabindex="0"
  role="textbox"
  aria-label="Terminal"
  style="display: block; outline: none;"
  on:keydown={handleKeydown}
></canvas>
