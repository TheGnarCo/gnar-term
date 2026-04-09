/**
 * Shared sidebar resize logic — used by both Sidebar.svelte and RightSidebar.svelte.
 *
 * Extracted to avoid near-identical resize implementations in each component.
 * Since this is plain TypeScript (no Svelte runes), components own the reactive
 * state and pass callbacks for width updates and drag-end.
 */

/**
 * Begin a sidebar resize drag. Attaches global mousemove/mouseup listeners
 * and tears them down on release.
 *
 * @param e          The initiating mousedown event.
 * @param direction  'left' = sidebar on the left side (delta is positive rightward);
 *                   'right' = sidebar on the right side (delta is inverted).
 * @param currentWidth  The sidebar's width at drag start.
 * @param minWidth      Minimum allowed width in pixels.
 * @param maxWidthFraction  Maximum width as a fraction of window.innerWidth.
 * @param onResize   Called on every mousemove with the new clamped width.
 * @param onEnd      Called once when the drag finishes (mouseup).
 */
export function startSidebarResize(
  e: MouseEvent,
  direction: "left" | "right",
  currentWidth: number,
  minWidth: number,
  maxWidthFraction: number,
  onResize: (width: number) => void,
  onEnd: () => void,
): void {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = currentWidth;

  function onMove(ev: MouseEvent) {
    const delta =
      direction === "left" ? ev.clientX - startX : startX - ev.clientX;
    const maxW = window.innerWidth * maxWidthFraction;
    onResize(Math.max(minWidth, Math.min(maxW, startWidth + delta)));
  }

  function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    onEnd();
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
