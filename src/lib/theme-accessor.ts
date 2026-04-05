/**
 * Non-reactive theme accessor for imperative code (preview plugins, etc.)
 * that can't use Svelte stores directly.
 */
import { get } from "svelte/store";
import { theme } from "./stores/theme";
import type { ThemeDef } from "./theme-data";

export function getTheme(): ThemeDef {
  return get(theme);
}

// Proxy for backwards-compatible access: theme.bg, theme.fg, etc.
export const themeProxy: ThemeDef = new Proxy({} as ThemeDef, {
  get(_target, prop) {
    const t = get(theme);
    if (prop === "ansi") return t.ansi;
    return (t as any)[prop as string];
  },
});
