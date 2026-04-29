<script lang="ts">
  /**
   * SidebarResizeHandle — shared resize divider for PrimarySidebar and
   * SecondarySidebar. Encapsulates dragging state, the dragResize action,
   * border-color theming, and keyboard resize support (ArrowLeft/ArrowRight
   * for WCAG 2.1 SC 2.1.1 keyboard operability).
   *
   * Props:
   *   direction — "right" for primary sidebar (handle on the right edge),
   *               "left" for secondary sidebar (handle on the left edge).
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

    // Derive the current handle position from its bounding rect so we can
    // feed a synthetic "clientX" to the parent's onDrag without knowing the
    // current width.
    const rect = handleEl.getBoundingClientRect();
    const currentX = rect.left + rect.width / 2;

    const delta = e.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    onDrag(currentX + delta);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  bind:this={handleEl}
  class="sidebar-resize-handle sidebar-resize-handle--{direction}"
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize sidebar"
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
  .sidebar-resize-handle:hover,
  .sidebar-resize-handle:focus-visible {
    filter: brightness(1.3);
    outline: none;
  }
</style>
