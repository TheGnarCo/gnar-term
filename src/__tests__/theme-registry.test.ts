import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerTheme,
  unregisterThemesBySource,
  registeredThemes,
  themeRegistry,
  validateTheme,
} from "../lib/services/theme-registry";
import { themes } from "../lib/theme-data";

const GOOD_THEME = themes["github-dark"];

describe("theme-registry", () => {
  beforeEach(() => {
    themeRegistry.reset();
  });

  it("registers a well-formed theme", () => {
    registerTheme("ext-a", "custom", GOOD_THEME);
    expect(get(registeredThemes)).toHaveProperty("custom");
  });

  it("rejects non-object payloads", () => {
    expect(() =>
      registerTheme("ext-a", "bad", null as unknown as typeof GOOD_THEME),
    ).toThrow(/registerTheme\("bad"\)/);
    expect(() =>
      registerTheme("ext-a", "bad", "nope" as unknown as typeof GOOD_THEME),
    ).toThrow(/theme must be an object/);
  });

  it("rejects themes missing required chrome keys", () => {
    const { accent: _drop, ...partial } = GOOD_THEME;
    expect(() =>
      registerTheme("ext-a", "bad", partial as unknown as typeof GOOD_THEME),
    ).toThrow(/"accent"/);
  });

  it("rejects themes missing the ansi block", () => {
    const { ansi: _drop, ...partial } = GOOD_THEME;
    expect(() =>
      registerTheme("ext-a", "bad", partial as unknown as typeof GOOD_THEME),
    ).toThrow(/theme\.ansi/);
  });

  it("rejects themes with incomplete ansi blocks", () => {
    const partial = {
      ...GOOD_THEME,
      ansi: { ...GOOD_THEME.ansi, brightCyan: undefined },
    };
    expect(() =>
      registerTheme("ext-a", "bad", partial as unknown as typeof GOOD_THEME),
    ).toThrow(/brightCyan/);
  });

  it("unregisters all themes for a source", () => {
    registerTheme("ext-a", "one", GOOD_THEME);
    registerTheme("ext-a", "two", GOOD_THEME);
    registerTheme("ext-b", "three", GOOD_THEME);
    unregisterThemesBySource("ext-a");
    const remaining = get(registeredThemes);
    expect(remaining).not.toHaveProperty("one");
    expect(remaining).not.toHaveProperty("two");
    expect(remaining).toHaveProperty("three");
  });

  it("validateTheme passes for built-in themes", () => {
    for (const [, theme] of Object.entries(themes)) {
      expect(() => validateTheme(theme)).not.toThrow();
    }
  });
});
