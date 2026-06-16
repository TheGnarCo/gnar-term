<script lang="ts">
  /**
   * SidebarResizeHandle — resize divider for the sidebar. Encapsulates
   * dragging state, the dragResize action, border-color theming, and
   * keyboard resize support (ArrowLeft/ArrowRight for WCAG 2.1 SC 2.1.1
   * keyboard operability). Replaces the inline resize <div> in Sidebar.
   *
   * Props:
   *   direction — "right" for the sidebar handle (on the right edge).
   *   onDrag    — called on every mousemove / keyboard step with the new
   *               clientX-equivalent offset so the parent can update its
   *               width store.
   *   theme     — reactive theme object (pass as $theme from the parent).
   */
  import { dragResize } from "../actions/drag-resize";
  import type { ThemeDef } from "../theme-data";

  export let direction: "left" | "right";
  export let onDrag: (clientX: number) => void;
  export let theme: ThemeDef;

  /** Step size in pixels for keyboard ArrowLeft / ArrowRight resize. */
  const KEYBOARD_STEP = 8;

  let dragging = false;
  let handleEl: HTMLElement;

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const rect = handleEl.getBoundingClientRect();
    const currentX = rect.left + rect.width / 2;
    const delta = e.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    onDrag(currentX + delta);
  }
</script>

<div
  bind:this={handleEl}
  class="sidebar-resize-handle sidebar-resize-handle--{direction}"
  role="slider"
  aria-orientation="horizontal"
  aria-label="Resize sidebar"
  aria-valuenow="0"
  aria-valuemin="0"
  aria-valuemax="100"
  tabindex="0"
  style="
    width: 4px; cursor: col-resize; flex-shrink: 0;
    background: {dragging ? theme.accent : theme.sidebarBorder};
    transition: background 0.15s;
  "
  use:dragResize={{
    onDrag: (ev) => onDrag(ev.clientX),
    onStart: () => {
      dragging = true;
    },
    onEnd: () => {
      dragging = false;
    },
  }}
  on:keydown={handleKeydown}
></div>

<style>
  .sidebar-resize-handle:hover {
    filter: brightness(1.3);
  }

  .sidebar-resize-handle:focus-visible {
    outline: 2px solid var(--theme-accent, #7c6aff);
    outline-offset: 2px;
  }
</style>
