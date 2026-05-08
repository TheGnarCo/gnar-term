/**
 * Verifies that banner drag is disabled while the sidebar is collapsed:
 *   - SidebarRail (container mode) does not surface the grip on hover
 *   - the unified root drag pipeline refuses to start a drag
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { get } from "svelte/store";
import SidebarRail from "../lib/components/SidebarRail.svelte";
import {
  sidebarVisible,
  canSidebarDrag,
  reorderContext,
} from "../lib/stores/ui";

describe("SidebarRail drag affordance gating", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
    reorderContext.set(null);
  });

  it("forbids drag when sidebar is collapsed (canSidebarDrag is false)", () => {
    sidebarVisible.set(false);
    expect(get(canSidebarDrag)).toBe(false);
  });

  it("allows drag when sidebar is expanded and not already reordering", () => {
    sidebarVisible.set(true);
    reorderContext.set(null);
    expect(get(canSidebarDrag)).toBe(true);
  });

  it("does not invoke onGripMouseDown when collapsed even on rail hover+mousedown", async () => {
    sidebarVisible.set(false);
    const onGripMouseDown = vi.fn();
    const { container } = render(SidebarRail, {
      props: {
        mode: "container",
        color: "#abc",
        canDrag: true,
        onGripMouseDown,
      },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    await fireEvent.mouseEnter(rail);
    await fireEvent.mouseDown(rail);
    expect(onGripMouseDown).not.toHaveBeenCalled();
  });

  it("invokes onGripMouseDown when expanded on rail hover+mousedown", async () => {
    sidebarVisible.set(true);
    reorderContext.set(null);
    const onGripMouseDown = vi.fn();
    const { container } = render(SidebarRail, {
      props: {
        mode: "container",
        color: "#abc",
        canDrag: true,
        onGripMouseDown,
      },
    });
    const rail = container.querySelector(
      "[data-sidebar-rail='container']",
    ) as HTMLElement;
    await fireEvent.mouseEnter(rail);
    await fireEvent.mouseDown(rail);
    expect(onGripMouseDown).toHaveBeenCalledTimes(1);
  });
});
