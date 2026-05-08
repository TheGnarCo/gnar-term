/**
 * Verifies that when the sidebar is collapsed, SidebarRail (container
 * mode) drops its 1px left border so there's no vertical seam between
 * the sidebar slot and the terminal area.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SidebarRail from "../lib/components/SidebarRail.svelte";
import { sidebarVisible } from "../lib/stores/ui";

describe("SidebarRail collapsed border", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("drops border-left when sidebar is collapsed (container mode)", () => {
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

  it("keeps border-left when sidebar is expanded (container mode)", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarRail, {
      props: { mode: "container", color: "#abc", canDrag: true },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.style.borderLeft).toMatch(/1px solid/);
  });
});
