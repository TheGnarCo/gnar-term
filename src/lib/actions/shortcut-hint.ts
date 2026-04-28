import { get } from "svelte/store";
import { shortcutHintsActive } from "../stores/shortcut-hints";
import { theme } from "../stores/theme";

export function shortcutHint(
  node: HTMLElement,
  label: string | null | undefined,
) {
  let badge: HTMLDivElement | null = null;
  let currentLabel = label;

  function showBadge() {
    if (!currentLabel || badge) return;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const t = get(theme);
    badge = document.createElement("div");
    badge.textContent = currentLabel;
    badge.setAttribute("aria-hidden", "true");
    badge.style.cssText = `
      position: fixed;
      z-index: 99999;
      pointer-events: none;
      left: ${rect.left + rect.width / 2}px;
      top: ${rect.bottom + 4}px;
      transform: translateX(-50%);
      background: ${t.accent};
      color: ${t.bg};
      font-size: 10px;
      font-family: inherit;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      line-height: 1.4;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(badge);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  }

  function hideBadge() {
    if (badge) {
      badge.remove();
      badge = null;
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    }
  }

  function reposition() {
    if (!badge) return;
    const rect = node.getBoundingClientRect();
    badge.style.left = `${rect.left + rect.width / 2}px`;
    badge.style.top = `${rect.bottom + 4}px`;
  }

  const unsub = shortcutHintsActive.subscribe((active) => {
    if (active) showBadge();
    else hideBadge();
  });

  return {
    update(newLabel: string | null | undefined) {
      currentLabel = newLabel;
      if (badge) {
        if (newLabel) badge.textContent = newLabel;
        else hideBadge();
      } else if (newLabel && get(shortcutHintsActive)) {
        showBadge();
      }
    },
    destroy() {
      unsub();
      hideBadge();
    },
  };
}
