import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup } from "@testing-library/svelte";

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

import Harness from "./sidebar-banner-with-leading-slot.svelte";
import WorkspaceListViewStub from "./workspace-list-view-stub.svelte";
import { workspaces } from "../lib/stores/workspace";
import { bannerCollapsedState } from "../lib/stores/ui";

describe("SidebarBanner with dashboards only", () => {
  beforeEach(() => {
    workspaces.set([] as never[]);
    bannerCollapsedState.set(new Map());
  });
  afterEach(() => {
    workspaces.set([]);
    bannerCollapsedState.set(new Map());
    cleanup();
  });

  const baseProps = {
    color: "#4a90d9",
    filterIds: new Set<string>(),
    scopeId: "ws-1",
    workspaceListViewComponent: WorkspaceListViewStub,
  };

  // Banners now default to collapsed; pre-seed the expanded flag for
  // tests that assert children-container structure or slot rendering.
  const expandedProps = (
    props: typeof baseProps & { dashboardCount: number },
  ) => {
    bannerCollapsedState.set(new Map([[props.scopeId, false]]));
    return props;
  };

  it("renders the children container when dashboardCount > 0 and no branches", async () => {
    const { container } = render(Harness, {
      props: expandedProps({ ...baseProps, dashboardCount: 2 }),
    });
    await tick();

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
  });

  it("shows the toggle when dashboardCount > 0 and no branches", async () => {
    const { container } = render(Harness, {
      props: { ...baseProps, dashboardCount: 1 },
    });
    await tick();

    expect(container.querySelector('[data-testid="toggle"]')).not.toBeNull();
  });

  it("does not render the children container when both counts are zero", async () => {
    const { container } = render(Harness, {
      props: { ...baseProps, dashboardCount: 0 },
    });
    await tick();

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();
  });

  it("auto-expands when dashboardCount grows on a populated collapsed banner", async () => {
    const { container, rerender } = render(Harness, {
      props: { ...baseProps, dashboardCount: 1 },
    });
    await tick();

    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).toBeNull();

    await rerender({ ...baseProps, dashboardCount: 2 });
    await tick();
    expect(
      container.querySelector("[data-sidebar-banner-children]"),
    ).not.toBeNull();
  });

  it("renders children-leading slot inside the children container when expanded", async () => {
    const { container } = render(Harness, {
      props: expandedProps({ ...baseProps, dashboardCount: 1 }),
    });
    await tick();

    const childrenContainer = container.querySelector(
      "[data-sidebar-banner-children]",
    );
    expect(childrenContainer).not.toBeNull();
    const leading = childrenContainer?.querySelector('[data-testid="leading"]');
    expect(leading).not.toBeNull();
  });

  it("does not render children-leading slot content when collapsed", async () => {
    const { container } = render(Harness, {
      props: { ...baseProps, dashboardCount: 1 },
    });
    await tick();

    expect(container.querySelector('[data-testid="leading"]')).toBeNull();
  });
});
