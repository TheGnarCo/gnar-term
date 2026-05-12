/**
 * Verifies that SidebarRail (container mode) never paints a left border.
 * The rail relies on its accent color, top/bottom borders, and optional
 * hat overlay to define its edges — a left border would frame the rail
 * away from its accent color and reintroduce the workspace-accent seam
 * that the hat fix is meant to eliminate.
 *
 * Also verifies the collapsed-mode top/bottom border policy: when the
 * row is in narrow-rail state, the `.collapsed-borderless` class is
 * applied so the dark theme.border tick marks above and below each
 * banner disappear. CSS `:hover` (asserted at the source level since
 * jsdom doesn't drive `:hover` from synthetic events) restores the
 * border color on demand.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import { readFileSync } from "fs";
import SidebarRail from "../lib/components/SidebarRail.svelte";
import { sidebarVisible } from "../lib/stores/ui";

describe("SidebarRail container border", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("never paints a left border (sidebar collapsed)", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "container", color: "#abc", canDrag: true },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.style.borderLeft).toBe("");
  });

  it("never paints a left border (sidebar expanded)", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarRail, {
      props: { mode: "container", color: "#abc", canDrag: true },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.style.borderLeft).toBe("");
  });
});

describe("SidebarRail collapsed-mode top/bottom borders", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("flags the rail collapsed-borderless when sidebar is collapsed and row is inactive", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "container", color: "#abc", canDrag: true },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.classList.contains("collapsed-borderless")).toBe(true);
  });

  it("does NOT flag the rail collapsed-borderless when the sidebar is expanded", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarRail, {
      props: { mode: "container", color: "#abc", canDrag: true },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.classList.contains("collapsed-borderless")).toBe(false);
  });

  it("does NOT flag the rail collapsed-borderless when the row is active (active = expanded look)", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: {
        mode: "container",
        color: "#abc",
        canDrag: true,
        isActive: true,
      },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.classList.contains("collapsed-borderless")).toBe(false);
  });

  it("does NOT flag the rail collapsed-borderless while the popover is open", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: {
        mode: "container",
        color: "#abc",
        canDrag: true,
        popoverActive: true,
      },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.classList.contains("collapsed-borderless")).toBe(false);
  });

  it("does NOT flag row-mode rails — only container-mode banners get the borderless treatment", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", canDrag: true },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='row']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.classList.contains("collapsed-borderless")).toBe(false);
  });

  it("source defines a :hover override that restores the border color", () => {
    // jsdom doesn't apply CSS :hover from synthetic mouseenter events, so
    // we assert the rule at the source level. Without this rule the
    // collapsed-borderless class would permanently kill the border even
    // on deliberate hover, defeating the affordance.
    const SOURCE = readFileSync(
      "src/lib/components/SidebarRail.svelte",
      "utf-8",
    ).replace(/\s+/g, " ");
    expect(SOURCE).toMatch(
      /\.rail-container\.collapsed-borderless\s*\{\s*border-top-color:\s*transparent;\s*border-bottom-color:\s*transparent;\s*\}/,
    );
    expect(SOURCE).toMatch(
      /\.rail-container\.collapsed-borderless:hover\s*\{\s*border-top-color:\s*var\(--rail-border-top-color\);\s*border-bottom-color:\s*var\(--rail-border-bottom-color\);\s*\}/,
    );
  });
});
