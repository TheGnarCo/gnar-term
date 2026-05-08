/**
 * `use:portal` — moves the host node into a destination element (default
 * `document.body`) at mount and restores it to its original parent at
 * destroy. Use this for floating UI (popovers, overlays) that need to
 * escape ancestor clipping, stacking contexts, or hit-test confinement.
 *
 * Real-world quirk this exists for: `position: fixed` is meant to escape
 * ancestor `overflow: hidden` for both painting AND hit-testing, but
 * some webviews (notably WKWebView in certain Tauri configurations)
 * still confine pointer events to the visual rect of an `overflow:
 * hidden` ancestor. Reparenting to `<body>` bypasses the issue.
 */
export function portal(node: HTMLElement, target: HTMLElement | null = null) {
  const dest =
    target ?? (typeof document !== "undefined" ? document.body : null);
  if (dest && dest !== node.parentNode) dest.appendChild(node);
  return {
    destroy() {
      // Detach unconditionally. Svelte's teardown won't find the node
      // where it inserted it (we moved it), so the safe path is to
      // remove from wherever the node currently lives.
      node.remove();
    },
  };
}
