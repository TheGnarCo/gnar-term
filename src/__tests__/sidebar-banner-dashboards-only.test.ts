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

describe("SidebarBanner with dashboards only", () => {
  beforeEach(() => workspaces.set([] as never[]));
  afterEach(() => {
    workspaces.set([]);
    cleanup();
  });

  const baseProps = {
    color: "#4a90d9",
    filterIds: new Set<string>(),
    scopeId: "ws-1",
    workspaceListViewComponent: WorkspaceListViewStub,
  };

  it("renders the children container when dashboardCount > 0 and no branches", async () => {
    const { container } = render(Harness, {
      props: { ...baseProps, dashboardCount: 2 },
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

  it("auto-expands when dashboardCount grows from zero while collapsed", async () => {
    const { container, rerender } = render(Harness, {
      props: { ...baseProps, dashboardCount: 1 },
    });
    await tick();

    const toggle = container.querySelector(
      '[data-testid="toggle"]',
    ) as HTMLElement;
    await fireEvent.click(toggle);
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
});
