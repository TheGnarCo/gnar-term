import { get } from "svelte/store";
import { shortcutHintsActive } from "../stores/shortcut-hints";
import { theme } from "../stores/theme";

export type ShortcutHintParam =
  | string
  | null
  | undefined
  | { label: string | null | undefined; placement: "right" | "below" };

function parseParam(param: ShortcutHintParam): {
  label: string | null | undefined;
  placement: "right" | "below";
} {
  if (param && typeof param === "object") {
    return { label: param.label, placement: param.placement };
  }
  return { label: param as string | null | undefined, placement: "right" };
}

function computePosition(
  rect: DOMRect,
  placement: "right" | "below",
): { left: string; top: string; transform: string } {
  if (placement === "below") {
    return {
      left: `${rect.left + rect.width / 2}px`,
      top: `${rect.bottom + 4}px`,
      transform: "translateX(-50%)",
    };
  }
  return {
    left: `${rect.right - 6}px`,
    top: `${rect.top + rect.height / 2}px`,
    transform: "translate(-100%, -50%)",
  };
}

export function shortcutHint(node: HTMLElement, param: ShortcutHintParam) {
  let badge: HTMLDivElement | null = null;
  let parsed = parseParam(param);

  function showBadge() {
    if (!parsed.label || badge) return;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const t = get(theme);
    const pos = computePosition(rect, parsed.placement);
    badge = document.createElement("div");
    badge.textContent = parsed.label;
    badge.setAttribute("aria-hidden", "true");
    badge.style.cssText = `
      position: fixed;
      z-index: 99999;
      pointer-events: none;
      left: ${pos.left};
      top: ${pos.top};
      transform: ${pos.transform};
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
    const pos = computePosition(rect, parsed.placement);
    badge.style.left = pos.left;
    badge.style.top = pos.top;
  }

  const unsub = shortcutHintsActive.subscribe((active) => {
    if (active) showBadge();
    else hideBadge();
  });

  return {
    update(newParam: ShortcutHintParam) {
      parsed = parseParam(newParam);
      if (badge) {
        if (parsed.label) badge.textContent = parsed.label;
        else hideBadge();
      } else if (parsed.label && get(shortcutHintsActive)) {
        showBadge();
      }
    },
    destroy() {
      unsub();
      hideBadge();
    },
  };
}
