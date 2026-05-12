/**
 * Verifies that SidebarRail (container mode) never paints a left border.
 * The rail relies on its accent color, top/bottom borders, and optional
 * hat overlay to define its edges — a left border would frame the rail
 * away from its accent color and reintroduce the workspace-accent seam
 * that the hat fix is meant to eliminate.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
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
