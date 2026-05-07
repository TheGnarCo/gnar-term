/**
 * Regression test: clicking the SidebarRail invokes its `onClick`
 * callback. The rail is the colored stripe on the left edge of every
 * workspace / branch / dashboard row — historically it was drag-only,
 * which made the workspace's collapsed-mode rail appear inert. Wiring
 * onClick lets ContainerRow forward `onBannerClick` and SidebarElement
 * forward `onRailClick`, so a rail click activates the row in any
 * sidebar mode.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import SidebarRail from "../lib/components/SidebarRail.svelte";

describe("SidebarRail onClick", () => {
  afterEach(() => cleanup());

  it("invokes onClick when the rail is clicked", async () => {
    const onClick = vi.fn();
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", onClick },
    });
    const rail = container.querySelector(
      '[data-sidebar-rail="row"]',
    ) as HTMLElement;
    expect(rail).not.toBeNull();
    await fireEvent.click(rail);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no onClick is provided", async () => {
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc" },
    });
    const rail = container.querySelector(
      '[data-sidebar-rail="row"]',
    ) as HTMLElement;
    // Should not throw.
    await fireEvent.click(rail);
    expect(rail).not.toBeNull();
  });
});
