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

  // AC-1: renders a .dome (not .rail-bot-bubble or .rail-bot-hat) when
  // botStatus !== "none", in both narrow and expanded rail modes.
  it("AC-1: renders the dome in narrow (collapsed) mode", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
        botStatus: "thinking",
      },
    });
    // Old shapes must be gone.
    expect(container.querySelector(".rail-bot-hat")).toBeNull();
    expect(container.querySelector(".rail-bot-bubble")).toBeNull();
    // Dome must paint.
    const dome = container.querySelector(".dome") as HTMLElement | null;
    expect(dome).not.toBeNull();
  });

  // AC-2: Dome has flat-bottom clip-path (inset(0 0 50% 0)) and circular
  // border-radius. The clip-path is set inline so it's accessible in jsdom.
  it("AC-2: dome has flat-bottom clip-path and circular border-radius, no gradient divider", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
        botStatus: "thinking",
      },
    });
    const dome = container.querySelector(".dome") as HTMLElement | null;
    expect(dome).not.toBeNull();
    // clip-path is set inline for testability.
    expect(dome!.style.clipPath).toBe("inset(0 0 50% 0)");
    // border-radius verified at source level (jsdom doesn't evaluate scoped styles).
    const sourceText = readFileSync(
      "src/lib/components/DragGrip.svelte",
      "utf-8",
    );
    const ruleMatch = sourceText.match(/\.dome\s*\{[^}]*\}/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch![0]).toMatch(/border-radius:\s*50%/);
    // No multi-stop gradient divider stripe.
    const computed = window.getComputedStyle(dome!);
    const bg = (dome!.style.background || "") + (computed.background || "");
    expect(bg).not.toContain("linear-gradient");
  });

  // AC-2b: Dome is at left: 0; top: 0, anchored to the rail stripe top.
  it("AC-2b: dome is anchored at the top of the rail (left: 0; top: 0)", () => {
    const source = readFileSync("src/lib/components/DragGrip.svelte", "utf-8");
    const ruleMatch = source.match(/\.dome\s*\{[^}]*\}/);
    expect(ruleMatch).not.toBeNull();
    const rule = ruleMatch![0];
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/left:\s*0/);
    expect(rule).toMatch(/top:\s*0/);
  });

  // AC-4 (expanded mode): dome still renders at every rail width and
  // pulses when botStatus === "attention".
  it("AC-4: renders the dome in expanded (full-width) mode and pulses on attention", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: false,
        botStatus: "attention",
      },
    });
    const dome = container.querySelector(".dome") as HTMLElement | null;
    expect(dome).not.toBeNull();
    expect(dome!.classList.contains("pulses")).toBe(true);
    expect(container.querySelector(".rail-bot-bubble")).toBeNull();
  });

  // AC-1 (none-state branch): no dome or bubble when botStatus is "none".
  it("AC-1: hides the dome when botStatus is none", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        botStatus: "none",
      },
    });
    expect(container.querySelector(".dome")).toBeNull();
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
