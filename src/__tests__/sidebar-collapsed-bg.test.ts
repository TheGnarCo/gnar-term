/**
 * Verifies the primary sidebar paints a transparent background when
 * collapsed so the terminal area's bg shows through (seamless rail look).
 * When expanded the sidebar still paints `$theme.sidebarBg`.
 *
 * JSDOM normalisation notes:
 *   - `background: transparent` is the CSS initial value; JSDOM strips it from
 *     both the style object and the raw attribute string.  We therefore assert
 *     its absence by checking that style.background is empty ("") rather than
 *     checking for the string "transparent".
 *   - `background: #hex` values are normalised to rgb() by JSDOM, so the
 *     expanded-state assertion converts the expected hex to rgb() first.
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

  it("uses transparent bg on the wrapper and content when collapsed", () => {
    sidebarVisible.set(false);
    const { container } = render(Sidebar);
    const wrapper = container.querySelector("#sidebar") as HTMLElement;
    const content = wrapper.querySelector(".sidebar-content") as HTMLElement;
    // JSDOM strips `background: transparent` (it is the CSS initial value),
    // leaving style.background as an empty string — which is the correct
    // signal that no opaque background is painted.
    expect(wrapper.style.background).toBe("");
    expect(content.style.background).toBe("");
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
