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

import ContainerRowWithSlot from "./container-row-with-slot.svelte";
import WorkspaceListViewStub from "./workspace-list-view-stub.svelte";
import { workspaces } from "../lib/stores/workspace";

// Seed the workspaces store so nonDashboardCount reflects filterIds correctly.
function makeWs(id: string) {
  return { id, name: id, panes: [], metadata: {} };
}

const baseProps = {
  color: "#4a90d9",
  filterIds: new Set(["ws-1"]),
  scopeId: "group-1",
  workspaceListViewComponent: WorkspaceListViewStub,
};

describe("ContainerRow collapse/expand", () => {
  beforeEach(() => workspaces.set([makeWs("ws-1"), makeWs("ws-2")] as never[]));
  afterEach(() => {
    workspaces.set([]);
    cleanup();
  });

  it("is expanded by default and collapses on chevron click", async () => {
    const { container } = render(ContainerRowWithSlot, { props: baseProps });

    expect(container.querySelector("[data-container-nested]")).not.toBeNull();

    const chevron = container.querySelector("button") as HTMLElement;
    await fireEvent.click(chevron);
    await tick();

    expect(container.querySelector("[data-container-nested]")).toBeNull();
  });

  it("auto-expands when a workspace is added while collapsed", async () => {
    const { container, rerender } = render(ContainerRowWithSlot, {
      props: baseProps,
    });

    const chevron = container.querySelector("button") as HTMLElement;
    await fireEvent.click(chevron);
    await tick();
    expect(container.querySelector("[data-container-nested]")).toBeNull();

    await rerender({ filterIds: new Set(["ws-1", "ws-2"]) });
    await tick();

    expect(container.querySelector("[data-container-nested]")).not.toBeNull();
  });

  it("stays collapsed when filterIds shrinks or stays the same size", async () => {
    const { container, rerender } = render(ContainerRowWithSlot, {
      props: { ...baseProps, filterIds: new Set(["ws-1", "ws-2"]) },
    });

    const chevron = container.querySelector("button") as HTMLElement;
    await fireEvent.click(chevron);
    await tick();
    expect(container.querySelector("[data-container-nested]")).toBeNull();

    await rerender({ filterIds: new Set(["ws-1"]) });
    await tick();

    expect(container.querySelector("[data-container-nested]")).toBeNull();
  });
});
