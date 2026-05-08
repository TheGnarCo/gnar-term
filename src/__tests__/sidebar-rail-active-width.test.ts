/**
 * Verifies the collapsed-mode rail width policy:
 *   - inactive + not hovered + popover closed → 4px stripe (slim accent)
 *   - active OR popover open                  → 8px stripe (anchored)
 *   - expanded sidebar                        → always 8px (legacy)
 *
 * The grip wrapper itself is always 8px wide; only the painted stripe
 * inside it changes width, so row layout never shifts when the policy
 * toggles.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SidebarRail from "../lib/components/SidebarRail.svelte";
import { sidebarVisible } from "../lib/stores/ui";

function railStripe(container: HTMLElement): HTMLElement | null {
  // The stripe is the first absolutely-positioned div inside the grip.
  return container.querySelector(".drag-grip > div") as HTMLElement | null;
}

describe("SidebarRail collapsed-mode rail width", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("paints a 4px stripe for an inactive row when collapsed", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", isActive: false },
    });
    const stripe = railStripe(container);
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("4px");
  });

  it("paints an 8px stripe when popoverActive is true (banner shown)", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: {
        mode: "row",
        color: "#abc",
        isActive: false,
        popoverActive: true,
      },
    });
    const stripe = railStripe(container);
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("8px");
  });

  it("paints an 8px stripe for an active row when collapsed", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", isActive: true },
    });
    const stripe = railStripe(container);
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("8px");
  });

  it("paints an 8px stripe regardless of active state when expanded", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", isActive: false },
    });
    const stripe = railStripe(container);
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("8px");
  });

  it("widens the stripe to 8px in container mode when an active child is present", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: {
        mode: "container",
        color: "#abc",
        canDrag: true,
        isActive: true,
      },
    });
    const stripe = railStripe(container);
    expect(stripe).not.toBeNull();
    expect(stripe!.style.width).toBe("8px");
  });
});
