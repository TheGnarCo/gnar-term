/**
 * Find Bar — in-terminal search UI using xterm.js SearchAddon
 *
 * Shows a floating search bar with input, prev/next, match count, and close.
 * Follows the app's theme system for consistent styling.
 */

import { SearchAddon } from "@xterm/addon-search";
import { theme, onThemeChange } from "./theme";
import type { TerminalManager } from "./terminal-manager";

let findBarEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let countEl: HTMLElement | null = null;
let isVisible = false;
let currentManager: TerminalManager | null = null;

/** Get the SearchAddon for the currently active surface */
function getSearchAddon(): SearchAddon | null {
  const surface = currentManager?.activeSurface;
  if (!surface) return null;
  return (surface as any).searchAddon ?? null;
}

function updateMatchCount() {
  // SearchAddon doesn't expose a match count API directly, so we just
  // clear the label when the query changes and rely on visual highlighting
  if (countEl) countEl.textContent = "";
}

function doSearch(direction: "next" | "prev") {
  const addon = getSearchAddon();
  if (!addon || !inputEl) return;
  const query = inputEl.value;
  if (!query) return;
  const opts = { regex: false, caseSensitive: false, wholeWord: false };
  if (direction === "next") {
    addon.findNext(query, opts);
  } else {
    addon.findPrevious(query, opts);
  }
}

function createFindBar(container: HTMLElement): HTMLElement {
  const bar = document.createElement("div");
  bar.id = "find-bar";
  bar.style.cssText = `
    position: absolute; top: 8px; right: 16px; z-index: 1000;
    display: flex; align-items: center; gap: 4px;
    background: ${theme.bgFloat}; border: 1px solid ${theme.border};
    border-radius: 6px; padding: 4px 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    font-size: 13px; color: ${theme.fg};
  `;

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Find...";
  input.style.cssText = `
    background: ${theme.bg}; border: 1px solid ${theme.border};
    border-radius: 4px; padding: 3px 8px; color: ${theme.fg};
    font-size: 13px; font-family: inherit; width: 200px;
    outline: none;
  `;
  input.addEventListener("focus", () => { input.style.borderColor = theme.accent; });
  input.addEventListener("blur", () => { input.style.borderColor = theme.border; });
  input.addEventListener("input", () => {
    updateMatchCount();
    doSearch("next");
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(e.shiftKey ? "prev" : "next");
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideFindBar();
    }
    // Stop propagation so terminal shortcuts don't fire
    e.stopPropagation();
  });

  const count = document.createElement("span");
  count.style.cssText = `color: ${theme.fgMuted}; font-size: 12px; min-width: 20px;`;

  const btnStyle = `
    background: none; border: none; color: ${theme.fgMuted};
    cursor: pointer; padding: 2px 4px; border-radius: 3px;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; line-height: 1;
  `;

  const prevBtn = document.createElement("button");
  prevBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12,10 8,6 4,10"/></svg>`;
  prevBtn.title = "Previous match (⇧⌘G)";
  prevBtn.style.cssText = btnStyle;
  prevBtn.addEventListener("click", () => doSearch("prev"));
  prevBtn.addEventListener("mouseenter", () => { prevBtn.style.color = theme.fg; prevBtn.style.background = theme.bgHighlight; });
  prevBtn.addEventListener("mouseleave", () => { prevBtn.style.color = theme.fgMuted; prevBtn.style.background = "none"; });

  const nextBtn = document.createElement("button");
  nextBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,6 8,10 12,6"/></svg>`;
  nextBtn.title = "Next match (⌘G)";
  nextBtn.style.cssText = btnStyle;
  nextBtn.addEventListener("click", () => doSearch("next"));
  nextBtn.addEventListener("mouseenter", () => { nextBtn.style.color = theme.fg; nextBtn.style.background = theme.bgHighlight; });
  nextBtn.addEventListener("mouseleave", () => { nextBtn.style.color = theme.fgMuted; nextBtn.style.background = "none"; });

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`;
  closeBtn.title = "Close (Esc)";
  closeBtn.style.cssText = btnStyle;
  closeBtn.addEventListener("click", () => hideFindBar());
  closeBtn.addEventListener("mouseenter", () => { closeBtn.style.color = theme.fg; closeBtn.style.background = theme.bgHighlight; });
  closeBtn.addEventListener("mouseleave", () => { closeBtn.style.color = theme.fgMuted; closeBtn.style.background = "none"; });

  bar.appendChild(input);
  bar.appendChild(count);
  bar.appendChild(prevBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);
  container.appendChild(bar);

  inputEl = input;
  countEl = count;
  findBarEl = bar;

  // Update colors on theme change
  onThemeChange(() => {
    bar.style.background = theme.bgFloat;
    bar.style.borderColor = theme.border;
    bar.style.color = theme.fg;
    input.style.background = theme.bg;
    input.style.borderColor = theme.border;
    input.style.color = theme.fg;
    count.style.color = theme.fgMuted;
  });

  return bar;
}

export function showFindBar(manager: TerminalManager) {
  currentManager = manager;
  const container = document.getElementById("terminal-area");
  if (!container) return;

  // Make container position-relative for absolute positioning of find bar
  container.style.position = "relative";

  if (!findBarEl) {
    createFindBar(container);
  }
  findBarEl!.style.display = "flex";
  isVisible = true;
  inputEl!.focus();
  inputEl!.select();
}

export function hideFindBar() {
  if (!findBarEl) return;
  const addon = getSearchAddon();
  if (addon) addon.clearDecorations();
  findBarEl.style.display = "none";
  isVisible = false;
  // Return focus to terminal
  const surface = currentManager?.activeSurface;
  if (surface?.terminal) surface.terminal.focus();
}

export function toggleFindBar(manager: TerminalManager) {
  if (isVisible) {
    hideFindBar();
  } else {
    showFindBar(manager);
  }
}

export function findNext() {
  if (isVisible) doSearch("next");
}

export function findPrev() {
  if (isVisible) doSearch("prev");
}

export function isFindBarVisible(): boolean {
  return isVisible;
}
