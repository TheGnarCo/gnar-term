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

  it("renders the bot-status hat in narrow (collapsed) mode", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
        botStatus: "thinking",
      },
    });
    const hat = container.querySelector(".rail-bot-hat") as HTMLElement | null;
    expect(hat).not.toBeNull();
    expect(hat!.style.width).toBe("4px");
  });

  it("paints the 2px dark divider between hat and rail in narrow (collapsed) mode", () => {
    // Regression: an earlier iteration dropped the divider in narrowRail
    // mode on the theory that 4px was too thin to read as a separator.
    // In practice, removing it made the hat color flow straight into
    // the rail color — losing the discrete "hat above rail" silhouette
    // that's the whole point of the shape. The divider must paint at
    // every rail width.
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: true,
        botStatus: "thinking",
      },
    });
    const hat = container.querySelector(".rail-bot-hat") as HTMLElement | null;
    expect(hat).not.toBeNull();
    const background = hat!.style.background;
    expect(background).toContain("linear-gradient");
    expect(background).toContain("rgba(0, 0, 0, 0.55)");
  });

  it("renders the bot-status hat in expanded (full-width) mode too", () => {
    // Regression: bot status used to be hidden when the sidebar was
    // expanded. Now the hat must paint at every rail width so agent
    // notifications stay visible regardless of sidebar layout.
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        narrowRail: false,
        botStatus: "attention",
      },
    });
    const hat = container.querySelector(".rail-bot-hat") as HTMLElement | null;
    expect(hat).not.toBeNull();
    expect(hat!.style.width).toBe("8px");
    expect(hat!.classList.contains("pulses")).toBe(true);
  });

  it("hides the bot-status hat when botStatus is none", () => {
    const { container } = render(DragGrip, {
      props: {
        theme: stubTheme,
        visible: false,
        railColor: "#abcdef",
        botStatus: "none",
      },
    });
    expect(container.querySelector(".rail-bot-hat")).toBeNull();
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
