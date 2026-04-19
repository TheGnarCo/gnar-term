/**
 * Theme registry — extension-contributed themes.
 *
 * Extensions register ThemeDef-shaped objects here via
 * `ExtensionAPI.registerTheme`. The combined list (built-in + registered)
 * appears in the theme picker and is resolvable by `theme.set(id)` in
 * stores/theme.ts.
 */
import { derived, type Readable } from "svelte/store";
import { createRegistry } from "./create-registry";
import type { ThemeDef } from "../theme-data";

export interface RegisteredTheme {
  id: string;
  source: string; // extension id (required by RegistryItem)
  theme: ThemeDef;
}

export const themeRegistry = createRegistry<RegisteredTheme>();

const REQUIRED_THEME_KEYS: ReadonlyArray<keyof ThemeDef> = [
  "name",
  "bg",
  "bgSurface",
  "bgFloat",
  "bgHighlight",
  "bgActive",
  "border",
  "borderActive",
  "borderNotify",
  "fg",
  "fgMuted",
  "fgDim",
  "accent",
  "accentHover",
  "notify",
  "notifyGlow",
  "danger",
  "success",
  "warning",
  "termBg",
  "termFg",
  "termCursor",
  "termSelection",
  "sidebarBg",
  "sidebarBorder",
  "tabBarBg",
  "tabBarBorder",
];

const REQUIRED_ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/**
 * Validates a theme registration payload and throws a descriptive error when
 * required keys are missing or malformed. Extensions hit this at register-time
 * so authoring mistakes surface immediately rather than producing blank chrome
 * after the theme is selected.
 */
export function validateTheme(theme: unknown): asserts theme is ThemeDef {
  if (!theme || typeof theme !== "object") {
    throw new Error(
      `theme must be an object, got ${theme === null ? "null" : typeof theme}`,
    );
  }
  const obj = theme as Record<string, unknown>;
  for (const key of REQUIRED_THEME_KEYS) {
    if (typeof obj[key] !== "string") {
      throw new Error(`theme is missing required string field "${key}"`);
    }
  }
  const ansi = obj.ansi;
  if (!ansi || typeof ansi !== "object") {
    throw new Error(`theme.ansi must be an object`);
  }
  const ansiObj = ansi as Record<string, unknown>;
  for (const key of REQUIRED_ANSI_KEYS) {
    if (typeof ansiObj[key] !== "string") {
      throw new Error(`theme.ansi is missing required string field "${key}"`);
    }
  }
}

export function registerTheme(
  source: string,
  id: string,
  theme: ThemeDef,
): void {
  try {
    validateTheme(theme);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`[extension:${source}] registerTheme("${id}"): ${reason}`);
  }
  themeRegistry.register({ id, source, theme });
}

export function unregisterThemesBySource(source: string): void {
  themeRegistry.unregisterBySource(source);
}

/** Reactive map of all registered themes keyed by id (extension-contributed). */
export const registeredThemes: Readable<Record<string, ThemeDef>> = derived(
  themeRegistry.store,
  ($entries) => {
    const out: Record<string, ThemeDef> = {};
    for (const entry of $entries) {
      out[entry.id] = entry.theme;
    }
    return out;
  },
);
