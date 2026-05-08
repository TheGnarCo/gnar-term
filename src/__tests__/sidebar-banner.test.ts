import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup, fireEvent } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// jsdom doesn't implement the Web Animations API used by svelte/transition slide.
// Call onfinish synchronously so the slide transition completes immediately.
Element.prototype.animate = vi.fn().mockImplementation(() => {
  let _onfinish: (() => void) | null = null;
  return {
    get onfinish() {
      return _onfinish;
    },
    set onfinish(fn: (() => void) | null) {
      _onfinish = fn;
      if (fn) fn();
    },
    cancel: vi.fn(),
  };
});

import SidebarBannerWithSlot from "./sidebar-banner-with-slot.svelte";
import WorkspaceListViewStub from "./workspace-list-view-stub.svelte";
import { workspaces } from "../lib/stores/workspace";
import { bannerCollapsedState } from "../lib/stores/ui";

// Seed the workspaces store so nonDashboardCount reflects filterIds correctly.
function makeWs(id: string) {
  return { id, name: id, panes: [], metadata: {} };
}

const baseProps = {
  color: "#4a90d9",
  filterIds: new Set(["ws-1"]),
  scopeId: "workspace-1",
  workspaceListViewComponent: WorkspaceListViewStub,
};

describe("SidebarBanner collapse/expand", () => {
  beforeEach(() => {
    workspaces.set([makeWs("ws-1"), makeWs("ws-2")] as never[]);
    bannerCollapsedState.set(new Map());
  });
  afterEach(() => {
    workspaces.set([]);
    bannerCollapsedState.set(new Map());
    cleanup();
  });

  it("is collapsed by default and expands on chevron click", async () => {
    const { container } = render(SidebarBannerWithSlot, { props: baseProps });

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();

    const chevron = container.querySelector("button") as HTMLElement;
    await fireEvent.click(chevron);
    await tick();

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
  });

  it("uses the persisted expanded flag when the store is pre-seeded", async () => {
    bannerCollapsedState.set(new Map([[baseProps.scopeId, false]]));
    const { container } = render(SidebarBannerWithSlot, { props: baseProps });

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
  });

  it("auto-expands when a workspace is added to a populated collapsed banner", async () => {
    const { container, rerender } = render(SidebarBannerWithSlot, {
      props: baseProps,
    });

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();

    await rerender({ filterIds: new Set(["ws-1", "ws-2"]) });
    await tick();

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
  });

  it("stays collapsed when filterIds shrinks or stays the same size", async () => {
    const { container, rerender } = render(SidebarBannerWithSlot, {
      props: { ...baseProps, filterIds: new Set(["ws-1", "ws-2"]) },
    });

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();

    await rerender({ filterIds: new Set(["ws-1"]) });
    await tick();

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();
  });

  it("two banner instances with the same scopeId share collapsed state via store", async () => {
    // Simulates the collapsed-sidebar setup where both the
    // main-view banner (clipped under the 12px rail strip) and the
    // popover banner are mounted simultaneously for the same row.
    // Toggling either chevron must update the rail height in the
    // other so the strip stays in sync with what the user just did.
    bannerCollapsedState.set(new Map([[baseProps.scopeId, false]]));
    const a = render(SidebarBannerWithSlot, { props: baseProps });
    const b = render(SidebarBannerWithSlot, { props: baseProps });

    expect(
      a.container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
    expect(
      b.container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();

    const chevronA = a.container.querySelector("button") as HTMLElement;
    await fireEvent.click(chevronA);
    await tick();

    expect(
      a.container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();
    expect(
      b.container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();

    const chevronB = b.container.querySelector("button") as HTMLElement;
    await fireEvent.click(chevronB);
    await tick();

    expect(
      a.container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
    expect(
      b.container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
  });

  it("clears banner hover state when the cursor leaves the document", async () => {
    // Regression: rows that sit flush with the viewport's left edge can
    // skip their own `mouseleave` when the cursor exits through that
    // edge fast (observed on WebKitGTK). The banner stays in its
    // hovered background until the cursor re-enters and exits via a
    // different edge. A body-level mouseleave is the authoritative
    // "cursor left the app" signal — `bannerHovered` must reset to
    // false in response.
    const { container } = render(SidebarBannerWithSlot, { props: baseProps });
    const banner = container.querySelector(
      "[data-sidebar-banner-row]",
    ) as HTMLElement;
    expect(banner).not.toBeNull();

    const restingStyle = banner.getAttribute("style") ?? "";

    await fireEvent.mouseEnter(banner);
    await tick();
    const hoveredStyle = banner.getAttribute("style") ?? "";
    expect(hoveredStyle).not.toBe(restingStyle);

    // Without the body-mouseleave fallback, this would leave the
    // banner stuck in its hovered style when the cursor exited the
    // viewport without re-crossing the row's own boundary.
    await fireEvent.mouseLeave(document.body);
    await tick();
    expect(banner.getAttribute("style") ?? "").toBe(restingStyle);
  });
});
