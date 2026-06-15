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
  // Tracks the teardown for an in-flight drag so a mid-drag unmount (the host
  // element is removed while the user is still holding the divider) can release
  // the window-level mousemove/mouseup listeners. Without this, an interrupted
  // drag leaks listeners that fire onDrag against a stale closure.
  let activeCleanup: (() => void) | null = null;

  function handleMousedown(e: MouseEvent) {
    if (opts.onStart) {
      const result = opts.onStart(e);
      if (result === false) return;
    }
    e.preventDefault();

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

    activeCleanup = cleanup;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  node.addEventListener("mousedown", handleMousedown);

  return {
    update(newOptions: DragResizeOptions) {
      opts = newOptions;
    },
    destroy() {
      node.removeEventListener("mousedown", handleMousedown);
      // Release any listeners from a drag still in flight at unmount.
      activeCleanup?.();
    },
  };
}
