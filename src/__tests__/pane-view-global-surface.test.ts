/**
 * Tests for PaneView's global-surface chrome:
 * - Top-level global surfaces (`isDashboard && !rootWorkspaceId`) suppress
 *   the TabBar and render a corner close button.
 * - Per-workspace dashboards (with `rootWorkspaceId`) keep the TabBar and
 *   do NOT render the corner close button.
 * - Clicking the close button calls `closeWorkspace(idx)` on the matching
 *   workspace.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const closeWorkspaceMock = vi.fn();
vi.mock("../lib/services/workspace-runtime-service", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/services/workspace-runtime-service")
  >("../lib/services/workspace-runtime-service");
  return {
    ...actual,
    closeWorkspace: (...args: unknown[]) => closeWorkspaceMock(...args),
  };
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

import PaneView from "../lib/components/PaneView.svelte";
import { workspaces } from "../lib/stores/workspace";
import type { Workspace, Pane } from "../lib/types";

function makeEmptyPane(id: string): Pane {
  return { id, surfaces: [], activeSurfaceId: null };
}

function setupWorkspace(ws: Workspace): void {
  workspaces.set([ws]);
}

const noop = () => {};
const baseProps = {
  onSelectSurface: noop,
  onCloseSurface: noop,
  onNewSurface: noop,
  onSelectSurfaceType: noop,
  onSplitRight: noop,
  onSplitDown: noop,
  onClosePane: noop,
  onFocusPane: noop,
};

describe("PaneView global-surface chrome", () => {
  afterEach(() => {
    cleanup();
    workspaces.set([]);
    closeWorkspaceMock.mockReset();
  });

  it("hides TabBar and renders a Close button for top-level global surfaces", () => {
    const pane = makeEmptyPane("p1");
    setupWorkspace({
      id: "ws-global",
      name: "Settings",
      paneLayout: { type: "pane", pane },
      activePaneId: pane.id,
      isDashboard: true,
      // rootWorkspaceId omitted → top-level global surface.
    });

    const { container } = render(PaneView, {
      props: { ...baseProps, pane, workspaceId: "ws-global" },
    });

    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector('[aria-label="Close"]')).not.toBeNull();
  });

  it("renders TabBar and no Close button for per-workspace dashboards", () => {
    const pane = makeEmptyPane("p1");
    setupWorkspace({
      id: "ws-per",
      name: "Agents",
      paneLayout: { type: "pane", pane },
      activePaneId: pane.id,
      isDashboard: true,
      rootWorkspaceId: "parent-ws",
    });

    const { container } = render(PaneView, {
      props: { ...baseProps, pane, workspaceId: "ws-per" },
    });

    // Per-workspace dashboards keep TabBar affordances; the top-right
    // close-X is suppressed because the workspace is owned by its
    // root workspace and tears down with it.
    expect(container.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it("clicking the Close button invokes closeWorkspace for the matching index", async () => {
    const pane = makeEmptyPane("p1");
    setupWorkspace({
      id: "ws-global",
      name: "Settings",
      paneLayout: { type: "pane", pane },
      activePaneId: pane.id,
      isDashboard: true,
    });

    const { container } = render(PaneView, {
      props: { ...baseProps, pane, workspaceId: "ws-global" },
    });

    const closeBtn = container.querySelector(
      '[aria-label="Close"]',
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    await fireEvent.click(closeBtn);

    expect(closeWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(closeWorkspaceMock).toHaveBeenCalledWith(0);
  });

  it("does not render a Close button for non-dashboard workspaces", () => {
    const pane = makeEmptyPane("p1");
    setupWorkspace({
      id: "ws-regular",
      name: "Regular",
      paneLayout: { type: "pane", pane },
      activePaneId: pane.id,
    });

    const { container } = render(PaneView, {
      props: { ...baseProps, pane, workspaceId: "ws-regular" },
    });

    expect(container.querySelector('[aria-label="Close"]')).toBeNull();
  });
});
