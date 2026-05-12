/**
 * Verifies the rail cursor policy. Cursor is no longer set as an inline
 * style; it's now class-driven CSS on the `.drag-grip` element so the
 * grip's `:hover` look survives the leftmost-viewport-edge race that
 * used to drop synthetic mouseleave events. These tests assert the
 * marker classes instead:
 *   - collapsed sidebar + rail has onClick → `.primary-clickable` (CSS: pointer)
 *   - expanded sidebar                     → no `.primary-clickable` (CSS: drag/default)
 *   - locked                               → `.locked` (CSS: not-allowed; overrides primary)
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

  it("marks the grip primary-clickable when collapsed and onClick is wired", () => {
    sidebarVisible.set(false);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", onClick: () => {} },
    });
    const g = grip(container);
    expect(g).not.toBeNull();
    expect(g!.classList.contains("primary-clickable")).toBe(true);
    expect(g!.classList.contains("locked")).toBe(false);
  });

  it("does NOT mark the grip primary-clickable when expanded, even if onClick is wired", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarRail, {
      props: { mode: "row", color: "#abc", onClick: () => {} },
    });
    const g = grip(container);
    expect(g).not.toBeNull();
    expect(g!.classList.contains("primary-clickable")).toBe(false);
  });

  it("marks the grip locked when locked, even when collapsed and clickable", () => {
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
    expect(g!.classList.contains("locked")).toBe(true);
  });
});
