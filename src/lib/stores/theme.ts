import { writable, derived, get, type Readable } from "svelte/store";
import type { ThemeDef } from "../theme-data";
import { registeredThemes } from "../services/theme-registry";

// Re-export theme data
export { themes, type ThemeDef } from "../theme-data";
import { themes } from "../theme-data";

/**
 * Merged view of built-in themes + extension-registered themes. Extensions
 * contribute via the theme-registry. When a matching theme id shows up in
 * both, the extension wins (it'll have been registered later).
 */
export const allThemes: Readable<Record<string, ThemeDef>> = derived(
  registeredThemes,
  ($registered) => ({ ...themes, ...$registered }),
);

function createThemeStore() {
  // Saved id is kept separately from the resolved theme: if the saved id
  // belongs to an extension that hasn't registered yet at boot, we keep
  // the id around and re-apply the moment the registry catches up.
  let savedId = "github-dark";
  try {
    const saved = localStorage.getItem("gnarterm-theme");
    if (saved) savedId = saved;
  } catch {}

  const initial = themes[savedId] ?? themes["github-dark"];
  const initialId = themes[savedId] ? savedId : "github-dark";

  const store = writable<ThemeDef>(initial);
  const id = writable<string>(initialId);

  function applyTheme(newId: string, t: ThemeDef): void {
    store.set(t);
    id.set(newId);
    document.documentElement.style.setProperty("--bg", t.bg);
    document.body.style.background = t.bg;
  }

  function setTheme(newId: string) {
    const available = get(allThemes);
    const t = available[newId];
    if (!t) return;
    applyTheme(newId, t);
    try {
      localStorage.setItem("gnarterm-theme", newId);
    } catch {}
  }

  // When extensions register late, the saved id may finally resolve. Watch
  // the merged map and re-apply if the current theme id matches something
  // we just gained access to. Avoids a "flash of default theme" when the
  // user's saved choice belongs to an extension.
  registeredThemes.subscribe(() => {
    const target = savedId;
    const currentId = get(id);
    if (currentId !== target) {
      const available = get(allThemes);
      const t = available[target];
      if (t) applyTheme(target, t);
    }
  });

  return {
    subscribe: store.subscribe,
    id: { subscribe: id.subscribe },
    set: (newId: string) => {
      savedId = newId;
      setTheme(newId);
    },
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
