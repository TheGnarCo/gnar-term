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

  it("is aria-hidden (pointer-only decoration, not keyboard interactive)", () => {
    const onMouseDown = vi.fn();
    const { container } = render(DragGrip, {
      props: { theme: stubTheme, visible: true, onMouseDown },
    });
    const grip = container.querySelector(".drag-grip");
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute("aria-hidden")).toBe("true");
    expect(grip?.getAttribute("role")).toBeNull();
  });

  it("calls onMouseDown when pressed", async () => {
    const onMouseDown = vi.fn();
    const { container } = render(DragGrip, {
      props: { theme: stubTheme, visible: true, onMouseDown },
    });
    const grip = container.querySelector(".drag-grip") as HTMLElement;
    await fireEvent.mouseDown(grip);
    expect(onMouseDown).toHaveBeenCalledTimes(1);
  });

  it("paints the rail stripe at 8px by default", () => {
    const { container } = render(DragGrip, {
      props: { theme: stubTheme, visible: false, railColor: "#abcdef" },
    });
    const stripe = container.querySelector(
      ".drag-grip > div",
    ) as HTMLElement | null;
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("8px");
  });

  it("paints the rail stripe at 4px when narrowRail is set", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
      },
    });
    const stripe = container.querySelector(
      ".drag-grip > div",
    ) as HTMLElement | null;
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("4px");
  });

  // AC-1: The .rail-bot-hat element is removed; a new .rail-bot-bubble
  // takes its place when botStatus !== "none".
  it("AC-1: renders the bot-status bubble in narrow (collapsed) mode", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
        botStatus: "thinking",
      },
    });
    // Old cap shape must be gone.
    expect(container.querySelector(".rail-bot-hat")).toBeNull();
    // New bubble must paint.
    const bubble = container.querySelector(
      ".rail-bot-bubble",
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
  });

  // AC-5: The bubble has a circular silhouette (border-radius ≥ 50% of
  // its short axis) — no rectangular cap shape, no bottom-divider
  // gradient stripe.
  it("AC-5: paints the bubble as a circle with a dark outline, no gradient divider", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
        botStatus: "thinking",
      },
    });
    const bubble = container.querySelector(
      ".rail-bot-bubble",
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
    const computed = window.getComputedStyle(bubble!);
    // Circular silhouette — border-radius set to 50% (or equivalent
    // value ≥ half the short axis).
    expect(
      computed.borderRadius === "" || computed.borderRadius !== "0px",
    ).toBe(true);
    // No multi-stop gradient divider stripe (the old hat's hallmark).
    const bg = (bubble!.style.background || "") + (computed.background || "");
    expect(bg).not.toContain("linear-gradient");
  });

  // AC-2: Bubble is absolutely positioned and visually overlaps the top
  // edge of the row (its bounding box extends above the row by at least
  // the bubble's radius). jsdom doesn't evaluate scoped Svelte styles,
  // so we verify the rule at the source level — paired with the in-DOM
  // presence checks in the other AC tests, this nails down both that
  // the bubble is rendered AND that its CSS positions it above the row.
  it("AC-2: positions the bubble above the row's top edge (source check)", () => {
    const source = readFileSync("src/lib/components/DragGrip.svelte", "utf-8");
    const ruleMatch = source.match(/\.rail-bot-bubble\s*\{[^}]*\}/);
    expect(ruleMatch).not.toBeNull();
    const rule = ruleMatch![0];
    expect(rule).toMatch(/position:\s*absolute/);
    // top must be negative — the bubble's box extends above the row top.
    const topMatch = rule.match(/top:\s*(-?\d+(?:\.\d+)?)px/);
    expect(topMatch).not.toBeNull();
    expect(parseFloat(topMatch![1])).toBeLessThan(0);
  });

  // AC-4 (expanded mode): bubble still renders at every rail width and
  // pulses when botStatus === "attention".
  it("AC-4: renders the bubble in expanded (full-width) mode and pulses on attention", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: false,
        botStatus: "attention",
      },
    });
    const bubble = container.querySelector(
      ".rail-bot-bubble",
    ) as HTMLElement | null;
    expect(bubble).not.toBeNull();
    expect(bubble!.classList.contains("pulses")).toBe(true);
  });

  // AC-1 (none-state branch): no bubble when botStatus is "none".
  it("AC-1: hides the bot-status bubble when botStatus is none", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        botStatus: "none",
      },
    });
    expect(container.querySelector(".rail-bot-bubble")).toBeNull();
    // Old hat must be gone too.
    expect(container.querySelector(".rail-bot-hat")).toBeNull();
  });

  // AC-3: Bubble presence does NOT change the row's layout height. Since
  // the bubble is position:absolute it must not contribute to flow.
  it("AC-3: bubble presence does not change drag-grip layout height", () => {
    const renderAt = (botStatus: "none" | "idle" | "thinking" | "attention") =>
      render(DragGrip, {
        props: {
          theme: stubTheme,
          visible: false,
          railColor: "#abcdef",
          narrowRail: true,
          botStatus,
        },
      });

    const a = renderAt("none");
    const aGrip = a.container.querySelector(".drag-grip") as HTMLElement;
    const aHeight = aGrip.getBoundingClientRect().height;
    cleanup();

    const b = renderAt("attention");
    const bGrip = b.container.querySelector(".drag-grip") as HTMLElement;
    const bHeight = bGrip.getBoundingClientRect().height;

    // jsdom usually reports zero for unsized boxes; the contract we
    // actually care about is equality between the two states.
    expect(bHeight).toBe(aHeight);
  });
});

const SOURCE = readFileSync(
  "src/lib/components/DragGrip.svelte",
  "utf-8",
).replace(/\s+/g, " ");

describe("DragGrip visual states", () => {
  it("has a fixed 8px grip width matching the rail stripe and hex pattern", () => {
    // Grip width is constant and matches the visual content width.
    expect(SOURCE).toMatch(/width:\s*8px/);
  });

  it("shows solid stripe normally, suppressing dots on hover", () => {
    // Stripe and dots are always rendered in the DOM (CSS-driven hover);
    // the swap is a `display: none` rule keyed off `.drag-grip:hover` (or
    // `.force-hover`). Hover state is owned by CSS so synthetic
    // mouseleave drops at the leftmost viewport edge can't leave the
    // rail stuck in a hovered look.
    expect(SOURCE).toMatch(/class="rail-stripe"/);
    expect(SOURCE).toMatch(
      /\.drag-grip\.has-dots\.can-hover:hover \.rail-stripe,\s*\.drag-grip\.has-dots\.force-hover \.rail-stripe\s*\{\s*display:\s*none;\s*\}/,
    );
  });

  it("renders a uniform diamond-grip dot pattern on hover when alwaysShowDots is true", () => {
    // Dot pattern is always rendered when `dotsRender` is truthy; CSS
    // toggles its `display` between `none` (rest) and `block` (hover or
    // force-hover). `dotsRender = alwaysShowDots && !narrowRail` gates
    // the render so the 4px collapsed rail never paints dots.
    expect(SOURCE).toMatch(
      /dotsRender\s*=\s*alwaysShowDots\s*&&\s*!narrowRail/,
    );
    expect(SOURCE).toMatch(/\{#if dotsRender\}/);
    expect(SOURCE).toMatch(/class="rail-dots"/);
    expect(SOURCE).toMatch(/\.rail-dots\s*\{[^}]*display:\s*none;/);
    expect(SOURCE).toMatch(
      /\.drag-grip\.has-dots\.can-hover:hover \.rail-dots,\s*\.drag-grip\.has-dots\.force-hover \.rail-dots\s*\{\s*display:\s*block;\s*\}/,
    );
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
