/**
 * Verifies the primary sidebar paints `$theme.bg` when collapsed so the
 * 12px rail strip is visually continuous with the terminal area (no
 * vertical seam from the hardcoded body bg in index.html, which only
 * matches one theme). When expanded the sidebar paints `$theme.sidebarBg`.
 *
 * JSDOM normalisation note: `background: #hex` values are normalised to
 * rgb() in the style object, so we convert expected hex values to rgb()
 * before comparing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import Sidebar from "../lib/components/Sidebar.svelte";
import { sidebarVisible } from "../lib/stores/ui";
import { theme } from "../lib/stores/theme";

/** Convert a hex colour like "#0d1117" to the rgb() string JSDOM stores. */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe("Sidebar collapsed background", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("paints theme.bg on the wrapper and content when collapsed", () => {
    sidebarVisible.set(false);
    const { container } = render(Sidebar);
    const wrapper = container.querySelector("#sidebar") as HTMLElement;
    const content = wrapper.querySelector(".sidebar-content") as HTMLElement;
    const rawExpected = get(theme).bg;
    const expected = rawExpected.startsWith("#")
      ? hexToRgb(rawExpected)
      : rawExpected;
    expect(wrapper.style.background).toBe(expected);
    expect(content.style.background).toBe(expected);
  });

  it("uses theme.sidebarBg on wrapper and content when expanded", () => {
    sidebarVisible.set(true);
    const { container } = render(Sidebar);
    const wrapper = container.querySelector("#sidebar") as HTMLElement;
    const content = wrapper.querySelector(".sidebar-content") as HTMLElement;
    // JSDOM normalises hex colours to rgb() in the style object.
    const rawExpected = get(theme).sidebarBg;
    const expected = rawExpected.startsWith("#")
      ? hexToRgb(rawExpected)
      : rawExpected;
    expect(wrapper.style.background).toBe(expected);
    expect(content.style.background).toBe(expected);
  });
});
