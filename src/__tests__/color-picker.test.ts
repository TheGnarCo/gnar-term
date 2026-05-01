/**
 * Tests for the GROUP_COLORS palette.
 */
import { describe, it, expect } from "vitest";
import {
  WORKSPACE_COLOR_SLOTS,
  getWorkspaceColors,
  resolveWorkspaceColor,
  themes,
} from "../lib/theme-data";

describe("WORKSPACE_COLOR_SLOTS", () => {
  it("has 12 slots", () => {
    expect(WORKSPACE_COLOR_SLOTS).toHaveLength(12);
  });

  it("has no duplicate slots", () => {
    const unique = new Set(WORKSPACE_COLOR_SLOTS);
    expect(unique.size).toBe(WORKSPACE_COLOR_SLOTS.length);
  });
});

describe("group color resolution", () => {
  it("resolves every slot to a hex in every theme", () => {
    for (const theme of Object.values(themes)) {
      const colors = getWorkspaceColors(theme);
      for (const slot of WORKSPACE_COLOR_SLOTS) {
        expect(colors[slot]).toMatch(/^#[0-9a-fA-F]{3,6}$/);
      }
    }
  });

  it("passes hex values through unchanged", () => {
    const theme = themes["one-dark"];
    expect(resolveWorkspaceColor("#abcdef", theme)).toBe("#abcdef");
  });

  it("returns theme-specific values for the same slot across themes", () => {
    const dark = resolveWorkspaceColor("red", themes["github-dark"]);
    const solarized = resolveWorkspaceColor("red", themes["solarized-dark"]);
    // Slot name identical but resolved hex differs per theme.
    expect(dark).not.toBe("red");
    expect(solarized).not.toBe("red");
    expect(dark).not.toBe(solarized);
  });
});
