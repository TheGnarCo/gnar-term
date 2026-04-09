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

  function handleMousedown(e: MouseEvent) {
    if (opts.onStart) {
      const result = opts.onStart(e);
      if (result === false) return;
    }
    e.preventDefault();

    function onMove(ev: MouseEvent) {
      opts.onDrag(ev);
    }

    function onUp() {
      opts.onEnd?.();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

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
    },
  };
}
