import { get } from "svelte/store";
import { theme } from "../stores/theme";

export function tooltip(node: HTMLElement, text: string | undefined) {
  let tip: HTMLDivElement | null = null;
  let currentText = text;

  function show() {
    if (!currentText || tip) return;
    const rect = node.getBoundingClientRect();
    const t = get(theme);
    tip = document.createElement("div");
    tip.textContent = currentText;
    tip.setAttribute("aria-hidden", "true");
    tip.style.cssText = `
      position: fixed;
      z-index: 99999;
      pointer-events: none;
      left: ${rect.left + rect.width / 2}px;
      top: ${rect.bottom + 6}px;
      transform: translateX(-50%);
      background: ${t.bgFloat ?? t.bgSurface ?? "#1e1e1e"};
      color: ${t.fg};
      font-size: 11px;
      font-family: inherit;
      font-weight: 500;
      padding: 4px 8px;
      border-radius: 5px;
      border: 1px solid ${t.border ?? "rgba(255,255,255,0.15)"};
      white-space: nowrap;
      line-height: 1.4;
      box-shadow: 0 4px 12px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(tip);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  }

  function hide() {
    if (tip) {
      tip.remove();
      tip = null;
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    }
  }

  function reposition() {
    if (!tip) return;
    const rect = node.getBoundingClientRect();
    tip.style.left = `${rect.left + rect.width / 2}px`;
    tip.style.top = `${rect.bottom + 6}px`;
  }

  node.addEventListener("mouseenter", show);
  node.addEventListener("mouseleave", hide);

  return {
    update(newText: string | undefined) {
      currentText = newText;
      if (tip) {
        if (currentText) tip.textContent = currentText;
        else hide();
      }
    },
    destroy() {
      hide();
      node.removeEventListener("mouseenter", show);
      node.removeEventListener("mouseleave", hide);
    },
  };
}
