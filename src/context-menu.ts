/**
 * Context menu system — native-feeling right-click menus
 */

import { theme } from "./theme";

export interface MenuItem {
  label: string;
  action: () => void;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

let activeMenu: HTMLElement | null = null;

function closeMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

// Close on any click outside
document.addEventListener("mousedown", (e) => {
  if (activeMenu && !activeMenu.contains(e.target as Node)) {
    closeMenu();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();

  const menu = document.createElement("div");
  menu.style.cssText = `
    position: fixed; z-index: 9999;
    background: ${theme.bgFloat}; border: 1px solid ${theme.border};
    border-radius: 8px; padding: 4px 0;
    min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    font-size: 13px; color: ${theme.fg};
  `;

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.style.cssText = `height: 1px; background: ${theme.border}; margin: 4px 8px;`;
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement("div");
    row.style.cssText = `
      padding: 6px 16px; cursor: ${item.disabled ? "default" : "pointer"};
      display: flex; align-items: center; justify-content: space-between;
      color: ${item.disabled ? theme.fgDim : item.danger ? theme.danger : theme.fg};
      opacity: ${item.disabled ? "0.5" : "1"};
    `;

    const label = document.createElement("span");
    label.textContent = item.label;
    row.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.textContent = item.shortcut;
      shortcut.style.cssText = `font-size: 11px; color: ${theme.fgDim}; margin-left: 24px;`;
      row.appendChild(shortcut);
    }

    if (!item.disabled) {
      row.addEventListener("mouseenter", () => {
        row.style.background = item.danger ? "#3b1111" : theme.bgHighlight;
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        item.action();
      });
    }

    menu.appendChild(row);
  }

  // Position — keep on screen
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.min(x, maxX)}px`;
  menu.style.top = `${Math.min(y, maxY)}px`;

  activeMenu = menu;
}
