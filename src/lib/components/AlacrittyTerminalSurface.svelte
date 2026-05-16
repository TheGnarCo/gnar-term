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

  /**
   * Track current grid dimensions so we can detect resizes in diffs.
   * On resize (diff rows/cols differ from snapshot), we need a fresh snapshot.
   * For Phase 1 we log a warning; requesting a fresh snapshot is cycle-6 work.
   */
  let currentCols = 80;
  let currentRows = 24;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  onMount(async () => {
    const ctx = canvasEl.getContext("2d");
    if (!ctx) {
      console.error("[AlacrittyTerminalSurface] canvas 2d context unavailable");
      return;
    }

    // Measure cell dimensions using the chosen font.
    ctx.font = `${fontSize}px ${fontFamily}`;
    const cellWidth = ctx.measureText("M").width;
    const cellHeight = fontSize * 1.2;

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

    channel = new Channel<TerminalChannelMessage>();

    channel.onmessage = (msg) => {
      if (!renderer) return;
      if (msg.kind === "snapshot") {
        const snap = msg.value as GridSnapshot;
        currentCols = snap.cols;
        currentRows = snap.rows;
        // Resize canvas to match the actual grid
        const r = new Renderer({
          ctx,
          fontFamily,
          fontSize,
          cellWidth,
          cellHeight,
        });
        canvasEl.width = snap.cols * cellWidth;
        canvasEl.height = snap.rows * cellHeight;
        renderer = r;
        renderer.paintSnapshot(snap);
      } else {
        // diff
        const diff = msg.value;
        if (diff.rows !== currentRows || diff.cols !== currentCols) {
          // TODO(cycle-6): request a fresh snapshot on resize rather than
          // continuing with stale dimensions.
          console.warn(
            "[AlacrittyTerminalSurface] grid resize detected in diff; " +
              "fresh snapshot request not yet implemented (cycle-6).",
          );
        }
        renderer.paintDiff(diff);
        renderer.paintCursor(diff.cursor);
      }
    };

    try {
      await invoke("attach_alacritty_engine", { ptyId, channel });
    } catch (err) {
      // cycle-4 may not have implemented attach_alacritty_engine yet.
      // Log and continue so the component renders without crashing the app.
      console.warn(
        "[AlacrittyTerminalSurface] attach_alacritty_engine not available:",
        err,
      );
    }

    canvasEl.focus();
  });

  onDestroy(() => {
    // cycle-4 added detach_alacritty_engine; invoke it if available.
    // If cycle-4 did not add it, the channel simply stops receiving messages.
    // TODO(cycle-6): confirm detach_alacritty_engine API surface with cycle-4's
    // manifest and add a runtime guard if the command may be absent.
    if (ptyId >= 0) {
      invoke("detach_alacritty_engine", { ptyId }).catch((err) => {
        console.warn(
          "[AlacrittyTerminalSurface] detach_alacritty_engine:",
          err,
        );
      });
    }
    channel = undefined;
    renderer = undefined;
  });

  // ─── Keyboard handling ─────────────────────────────────────────────────────

  /**
   * Encode a KeyboardEvent to a PTY byte sequence.
   *
   * Phase 1 coverage (cycle-5):
   *   - Printable ASCII (event.key.length === 1)
   *   - Enter → CR (\r)
   *   - Backspace → DEL (\x7f)
   *   - Tab → \t
   *   - Arrow keys → CSI sequences
   *
   * TODO(cycle-7/phase-2): Add full xterm key encoding:
   *   - Ctrl+letter sequences (\x01–\x1a)
   *   - Alt/Meta combos (ESC prefix)
   *   - F1–F12 (SS3 / CSI ~ sequences)
   *   - Shift+arrow, Ctrl+arrow modifier combos
   *   - Home, End, Insert, Delete, Page Up/Down
   *   - Numpad keys
   */
  function encodeKey(e: KeyboardEvent): string | null {
    switch (e.key) {
      case "Enter":
        return "\r";
      case "Backspace":
        return "\x7f";
      case "Tab":
        return "\t";
      case "ArrowUp":
        return "\x1b[A";
      case "ArrowDown":
        return "\x1b[B";
      case "ArrowRight":
        return "\x1b[C";
      case "ArrowLeft":
        return "\x1b[D";
      default:
        // Printable ASCII / UTF-8 (single grapheme cluster from keyboard)
        if (e.key.length === 1) return e.key;
        return null;
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    const data = encodeKey(e);
    if (data === null) return;
    e.preventDefault();
    // Match existing xterm.js convention: invoke('write_pty', { ptyId, data })
    invoke("write_pty", { ptyId, data }).catch((err) => {
      console.warn("[AlacrittyTerminalSurface] write_pty failed:", err);
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
