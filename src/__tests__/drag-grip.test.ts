import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { readFileSync } from "fs";
import DragGrip from "../lib/components/DragGrip.svelte";

const stubTheme = {
  name: "Test",
  bg: "#000",
  bgSurface: "#111",
  bgFloat: "#222",
  bgActive: "#333",
  bgHighlight: "#444",
  fg: "#fff",
  fgMuted: "#aaa",
  fgDim: "#888",
  accent: "#0af",
  border: "#555",
  borderActive: "#0af",
  danger: "#f33",
  notify: "#fa3",
  sidebarBg: "#000",
  sidebarBorder: "#222",
} as unknown as Parameters<typeof render>[1];

describe("DragGrip", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders with role=button and accessible label", () => {
    const onMouseDown = vi.fn();
    const { container } = render(DragGrip, {
      props: { theme: stubTheme, visible: true, onMouseDown },
    });
    const grip = container.querySelector('[role="button"]');
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute("aria-label")).toMatch(/drag/i);
  });

  it("calls onMouseDown when pressed", async () => {
    const onMouseDown = vi.fn();
    const { container } = render(DragGrip, {
      props: { theme: stubTheme, visible: true, onMouseDown },
    });
    const grip = container.querySelector('[role="button"]') as HTMLElement;
    await fireEvent.mouseDown(grip);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });
});

const SOURCE = readFileSync(
  "src/lib/components/DragGrip.svelte",
  "utf-8",
).replace(/\s+/g, " ");

describe("DragGrip visual states", () => {
  it("collapsed state has a 10px hit area and a 6px rail; expands to 20px on hover", () => {
    // Grip width toggles on visible: 20px expanded / 10px at rest.
    expect(SOURCE).toMatch(
      /width:\s*\{\s*visible\s*\?\s*'20px'\s*:\s*'10px'\s*\}/,
    );
    // Rail stripe is a constant 6px (scaled with the container width).
    expect(SOURCE).toMatch(/width:\s*6px/);
  });

  it("suppresses the rail stripe whenever the dot pattern is rendered", () => {
    // Rail stripe and dots are mutually exclusive — showRailStripe derives
    // from !showDots so they never stack on top of each other.
    expect(SOURCE).toMatch(/showRailStripe\s*=\s*!showDots/);
    expect(SOURCE).toMatch(/\{#if showRailStripe\}/);
  });

  it("renders a uniform diamond-grip dot pattern when visible or alwaysShowDots", () => {
    expect(SOURCE).toMatch(/showDots\s*=\s*visible\s*\|\|\s*alwaysShowDots/);
    expect(SOURCE).toMatch(/\{#if showDots\}/);
    // Both rest and expanded states use the same 2-gradient diamond-grip
    // tile (dots at (0,0) and (2.5, 2.5)). Only the radius + fade change.
    const gradientCount = (SOURCE.match(/radial-gradient\(circle,/g) ?? [])
      .length;
    expect(gradientCount).toBe(2);
  });

  it("uses a fixed dot pattern (size + softness stay the same across states)", () => {
    // Hover/expansion must not change the frits' color, size, or
    // softness — only the rail's WIDTH grows. Dot constants are fixed.
    expect(SOURCE).toMatch(/dotRadius\s*=\s*"[\d.]+px"/);
    expect(SOURCE).toMatch(/dotFade\s*=\s*"[\d.]+px"/);
    // No visible-conditional on dotRadius/dotFade anymore.
    expect(SOURCE).not.toMatch(/dotRadius\s*=\s*visible\s*\?/);
    expect(SOURCE).not.toMatch(/dotFade\s*=\s*visible\s*\?/);
  });

  it("uses a 5×5 diamond-stagger tile in both states (same positions, different sizes)", () => {
    // Position/size are state-invariant — only the radius + fade change.
    expect(SOURCE).toMatch(/fritBackgroundSize\s*=\s*"5px 5px"/);
    expect(SOURCE).toMatch(
      /fritBackgroundPosition\s*=\s*"0 0,\s*2\.5px\s*2\.5px"/,
    );
    expect(SOURCE).toMatch(/fritBackgroundRepeat\s*=\s*"repeat"/);
  });
});
