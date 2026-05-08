/**
 * Verifies the rail cursor policy:
 *   - collapsed sidebar + rail has onClick → `pointer` (click is primary)
 *   - expanded sidebar                     → falls through to drag/default
 *   - locked                                → `not-allowed`
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SidebarRail from "../lib/components/SidebarRail.svelte";
import { sidebarVisible } from "../lib/stores/ui";

function grip(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".drag-grip") as HTMLElement | null;
}

describe("SidebarRail cursor policy", () => {
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
  });

  it("uses pointer cursor when collapsed and onClick is wired", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", onClick: () => {} },
    });
    const g = grip(container);
    expect(g).not.toBeNull();
    expect(g!.style.cursor).toBe("pointer");
  });

  it("does NOT use pointer cursor when expanded, even if onClick is wired", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", onClick: () => {} },
    });
    const g = grip(container);
    expect(g).not.toBeNull();
    expect(g!.style.cursor).not.toBe("pointer");
  });

  it("uses not-allowed cursor when locked, even when collapsed and clickable", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: {
        mode: "row",
        color: "#abc",
        onClick: () => {},
        locked: true,
      },
    });
    const g = grip(container);
    expect(g).not.toBeNull();
    expect(g!.style.cursor).toBe("not-allowed");
  });
});
