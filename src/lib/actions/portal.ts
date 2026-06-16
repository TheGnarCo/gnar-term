/**
 * portal — Svelte action that relocates a node to `document.body` (or a
 * given target) for the lifetime of the component, then restores it on
 * destroy. Used by the collapsed-sidebar popover so it escapes the
 * sidebar's `overflow: hidden` + low-z-index stacking/clipping context.
 *
 * In real WKWebView (Tauri on macOS) a `position: fixed` descendant of an
 * `overflow: hidden` ancestor still has its pointer events clipped to the
 * ancestor's visual rect, so the popover must physically live on <body>.
 */
export function portal(node: HTMLElement, target: HTMLElement | string = "body") {
  let targetEl: HTMLElement | null = null;

  function mount() {
    if (typeof document === "undefined") return;
    targetEl =
      typeof target === "string"
        ? document.querySelector<HTMLElement>(target)
        : target;
    if (targetEl) targetEl.appendChild(node);
  }

  mount();

  return {
    update(newTarget: HTMLElement | string) {
      target = newTarget;
      mount();
    },
    destroy() {
      node.parentNode?.removeChild(node);
    },
  };
}
