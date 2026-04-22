import { writable, derived } from "svelte/store";
import type { ThemeDef } from "../theme-data";

// Re-export theme data
export { themes, type ThemeDef } from "../theme-data";
import { themes } from "../theme-data";

function createThemeStore() {
  // Restore saved theme
  let initial = themes["github-dark"];
  let initialId = "github-dark";
  try {
    const saved = localStorage.getItem("gnarterm-theme");
    if (saved && themes[saved]) {
      initial = themes[saved];
      initialId = saved;
    }
  } catch {}

  const store = writable<ThemeDef>(initial);
  const id = writable<string>(initialId);

  function setTheme(newId: string) {
    const t = themes[newId];
    if (!t) return;
    store.set(t);
    id.set(newId);
    document.documentElement.style.setProperty("--bg", t.bg);
    document.body.style.background = t.bg;
    try { localStorage.setItem("gnarterm-theme", newId); } catch {}
  }

  return {
    subscribe: store.subscribe,
    id: { subscribe: id.subscribe },
    set: setTheme,
  };
}

export const theme = createThemeStore();

export const xtermTheme = derived(theme, ($theme) => ({
  background: $theme.termBg,
  foreground: $theme.termFg,
  cursor: $theme.termCursor,
  cursorAccent: $theme.termBg,
  selectionBackground: $theme.termSelection,
  selectionForeground: $theme.termFg,
  ...$theme.ansi,
}));
