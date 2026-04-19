/**
 * Tests for the PROJECT_COLORS palette.
 */
import { describe, it, expect } from "vitest";
import {
  PROJECT_COLOR_SLOTS,
  getProjectColors,
  resolveProjectColor,
  themes,
} from "../lib/theme-data";

describe("PROJECT_COLOR_SLOTS", () => {
  it("has 12 slots", () => {
    expect(PROJECT_COLOR_SLOTS).toHaveLength(12);
  });

  it("has no duplicate slots", () => {
    const unique = new Set(PROJECT_COLOR_SLOTS);
    expect(unique.size).toBe(PROJECT_COLOR_SLOTS.length);
  });
});

describe("project color resolution", () => {
  it("resolves every slot to a hex in every theme", () => {
    for (const theme of Object.values(themes)) {
      const colors = getProjectColors(theme);
      for (const slot of PROJECT_COLOR_SLOTS) {
        expect(colors[slot]).toMatch(/^#[0-9a-fA-F]{3,6}$/);
      }
    }
  });

  it("passes hex values through unchanged", () => {
    const theme = themes["one-dark"];
    expect(resolveProjectColor("#abcdef", theme)).toBe("#abcdef");
  });

  it("returns theme-specific values for the same slot across themes", () => {
    const dark = resolveProjectColor("red", themes["github-dark"]);
    const solarized = resolveProjectColor("red", themes["solarized-dark"]);
    // Slot name identical but resolved hex differs per theme.
    expect(dark).not.toBe("red");
    expect(solarized).not.toBe("red");
    expect(dark).not.toBe(solarized);
  });
});
