/**
 * theme-bridge.test.ts — unit tests for theme-bridge.ts
 *
 * Tests verify:
 *  - theme_swap_notifies_renderer_with_new_palette
 *  - theme palette mapping produces correct NamedSlot values
 *  - detach stops future palette notifications
 */

import { describe, it, expect, vi } from "vitest";
import { attachThemeBridge, mapThemeToPalette } from "./theme-bridge";
import type { Palette } from "./theme-bridge";
import { theme } from "../../stores/theme";
import { get } from "svelte/store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOpts(): {
  onPaletteChanged: (palette: Palette) => void;
  onRenderRequested: () => void;
  paletteSpy: ReturnType<typeof vi.fn<(palette: Palette) => void>>;
  renderSpy: ReturnType<typeof vi.fn<() => void>>;
} {
  const paletteSpy = vi.fn<(palette: Palette) => void>();
  const renderSpy = vi.fn<() => void>();
  return {
    onPaletteChanged: paletteSpy,
    onRenderRequested: renderSpy,
    paletteSpy,
    renderSpy,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("theme_bridge", () => {
  it("calls onPaletteChanged synchronously on attach with current theme palette", () => {
    const { onPaletteChanged, onRenderRequested, paletteSpy } = makeOpts();
    const handle = attachThemeBridge({ onPaletteChanged, onRenderRequested });

    // Svelte store fires synchronously on subscribe — should have been called once already
    expect(paletteSpy).toHaveBeenCalledTimes(1);
    const firstCall = paletteSpy.mock.calls[0];
    const palette: Palette = firstCall ? firstCall[0] : {};
    expect(typeof palette.foreground).toBe("string");
    expect(palette.foreground).toMatch(/^#[0-9a-fA-F]{6}$/);

    handle.detach();
  });

  it("calls onRenderRequested after onPaletteChanged on attach", () => {
    const callOrder: string[] = [];
    const onPaletteChanged = vi.fn<(palette: Palette) => void>(() =>
      callOrder.push("palette"),
    );
    const onRenderRequested = vi.fn<() => void>(() => callOrder.push("render"));

    const handle = attachThemeBridge({ onPaletteChanged, onRenderRequested });
    expect(callOrder).toEqual(["palette", "render"]);

    handle.detach();
  });

  it("theme_swap_notifies_renderer_with_new_palette on subsequent theme change", () => {
    const { onPaletteChanged, onRenderRequested, paletteSpy } = makeOpts();
    const handle = attachThemeBridge({ onPaletteChanged, onRenderRequested });

    // Capture the initial call count
    const initialCount = paletteSpy.mock.calls.length;

    // Swap theme — triggers a second notification
    theme.set("tokyo-night");

    expect(paletteSpy.mock.calls.length).toBeGreaterThan(initialCount);
    const lastCall = paletteSpy.mock.calls[paletteSpy.mock.calls.length - 1];
    const newPalette: Palette = lastCall ? lastCall[0] : {};

    // tokyo-night termFg is #c0caf5
    expect(newPalette.foreground).toBe("#c0caf5");

    // Restore default theme for other tests
    theme.set("github-dark");
    handle.detach();
  });

  it("detach stops future palette notifications", () => {
    const { onPaletteChanged, onRenderRequested, paletteSpy } = makeOpts();
    const handle = attachThemeBridge({ onPaletteChanged, onRenderRequested });

    const countAfterAttach = paletteSpy.mock.calls.length;
    handle.detach();

    // Changing theme after detach should not fire the callback
    theme.set("tokyo-night");
    expect(paletteSpy.mock.calls.length).toBe(countAfterAttach);

    // Restore
    theme.set("github-dark");
  });

  it("mapThemeToPalette maps all NamedSlot keys correctly", () => {
    const themeDef = get(theme);
    const palette = mapThemeToPalette(themeDef);

    const requiredKeys: Array<keyof Palette> = [
      "foreground",
      "background",
      "cursor",
      "bright_foreground",
      "dim_foreground",
      "dim_black",
      "dim_red",
      "dim_green",
      "dim_yellow",
      "dim_blue",
      "dim_magenta",
      "dim_cyan",
      "dim_white",
    ];

    for (const key of requiredKeys) {
      expect(palette[key], `missing key: ${key}`).toBeDefined();
      expect(typeof palette[key]).toBe("string");
    }
  });

  it("palette background matches termBg from ThemeDef", () => {
    const themeDef = get(theme);
    const palette = mapThemeToPalette(themeDef);
    expect(palette.background).toBe(themeDef.termBg);
  });

  it("palette foreground matches termFg from ThemeDef", () => {
    const themeDef = get(theme);
    const palette = mapThemeToPalette(themeDef);
    expect(palette.foreground).toBe(themeDef.termFg);
  });

  it("palette cursor matches termCursor from ThemeDef", () => {
    const themeDef = get(theme);
    const palette = mapThemeToPalette(themeDef);
    expect(palette.cursor).toBe(themeDef.termCursor);
  });

  it("dim variants are darker than the base ansi colors", () => {
    // Use a known theme with hex colors
    const mockTheme = {
      termFg: "#e6edf3",
      termBg: "#161b22",
      termCursor: "#e6edf3",
      ansi: {
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    };

    const palette = mapThemeToPalette(mockTheme);

    // dim_red should have lower channel values than red (#ff7b72)
    // red: r=255, g=123, b=114 → dim at 60%: r=153, g=73, b=68 → #994944 approx
    expect(palette.dim_red).toBeDefined();
    const dimRed = palette.dim_red ?? "#000000";
    const rDim = parseInt(dimRed.slice(1, 3), 16);
    const rBase = parseInt(mockTheme.ansi.red.slice(1, 3), 16);
    expect(rDim).toBeLessThan(rBase);
  });
});
