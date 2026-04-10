/**
 * Non-reactive theme accessor for imperative code (preview modules, etc.)
 * that can't use Svelte stores directly.
 */
import { get } from "svelte/store";
import { theme } from "./stores/theme";
import type { ThemeDef } from "./theme-data";

// Proxy for non-reactive access: theme.bg, theme.fg, etc.
export const themeProxy: ThemeDef = new Proxy({} as ThemeDef, {
  get(_target, prop) {
    const t = get(theme);
    if (prop === "ansi") return t.ansi;
    return t[prop as keyof ThemeDef];
  },
});
