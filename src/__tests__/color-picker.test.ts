/**
 * Tests for the PROJECT_COLORS palette.
 */
import { describe, it, expect } from "vitest";
import { PROJECT_COLORS } from "../extensions/project-scope";

describe("PROJECT_COLORS palette", () => {
  it("has 12 colors", () => {
    expect(PROJECT_COLORS).toHaveLength(12);
  });

  it("all entries are valid hex colors", () => {
    for (const color of PROJECT_COLORS) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has no duplicate colors", () => {
    const unique = new Set(PROJECT_COLORS.map((c) => c.toLowerCase()));
    expect(unique.size).toBe(PROJECT_COLORS.length);
  });

  it("includes the original 8 colors", () => {
    const original = [
      "#e06c75",
      "#98c379",
      "#e5c07b",
      "#61afef",
      "#c678dd",
      "#56b6c2",
      "#d19a66",
      "#be5046",
    ];
    for (const color of original) {
      expect(PROJECT_COLORS).toContain(color);
    }
  });

  it("includes the 4 new colors", () => {
    const added = ["#ff6ac1", "#43d08a", "#7aa2f7", "#f5a97f"];
    for (const color of added) {
      expect(PROJECT_COLORS).toContain(color);
    }
  });
});

describe("randomColor", () => {
  it("always returns a color from PROJECT_COLORS", () => {
    for (let i = 0; i < 50; i++) {
      const idx = Math.floor(Math.random() * PROJECT_COLORS.length);
      expect(PROJECT_COLORS).toContain(PROJECT_COLORS[idx]);
    }
  });
});
