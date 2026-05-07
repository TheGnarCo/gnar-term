/**
 * Svelte action for drag-to-resize behavior.
 * Used by sidebar resize handles and split dividers.
 *
 * Usage:
 *   <div use:dragResize={{ onDrag, onStart, onEnd }} />
 */
export interface DragResizeOptions {
  /** Called on every mousemove during drag. Receives the mouse event. */
  onDrag: (e: MouseEvent) => void;
  /** Called when drag starts. Return false to cancel. */
  onStart?: (e: MouseEvent) => boolean | void;
  /** Called when drag ends. */
  onEnd?: () => void;
}

export function dragResize(node: HTMLElement, options: DragResizeOptions) {
  let opts = options;
  // Track the in-flight drag so `destroy()` can tear down window listeners
  // if the host component unmounts mid-drag. Without this, `mousemove` and
  // `mouseup` would stay bound to stale closures that reference a removed
  // node.
  let activeCleanup: (() => void) | null = null;

  function handleMousedown(e: MouseEvent) {
    if (opts.onStart) {
      const result = opts.onStart(e);
      if (result === false) return;
    }
    e.preventDefault();

    // Cancel any prior drag before starting a new one (defensive — mousedown
    // shouldn't fire twice without a mouseup, but belt-and-braces).
    activeCleanup?.();

    function onMove(ev: MouseEvent) {
      opts.onDrag(ev);
    }

    function cleanup() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      activeCleanup = null;
    }

    function onUp() {
      opts.onEnd?.();
      cleanup();
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    activeCleanup = cleanup;
  }

  node.addEventListener("mousedown", handleMousedown);

  return {
    update(newOptions: DragResizeOptions) {
      opts = newOptions;
    },
    destroy() {
      node.removeEventListener("mousedown", handleMousedown);
      activeCleanup?.();
    },
  };
}
