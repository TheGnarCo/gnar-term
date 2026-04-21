/**
 * PaneView renders the shared `GroupDashboardSettings` body (not a
 * preview surface, not a tab strip) for a workspace whose metadata
 * marks it as the "settings" dashboard contribution.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

import PaneView from "../lib/components/PaneView.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { workspaceGroupsStore } from "../lib/stores/workspace-groups";
import type { Workspace, Pane } from "../lib/types";

function makePane(id: string): Pane {
  return {
    id,
    surfaces: [],
    activeSurfaceId: undefined,
    activeIdx: 0,
  } as unknown as Pane;
}

const noop = () => {};

describe("PaneView — settings dashboard body", () => {
  beforeEach(() => {
    cleanup();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    workspaceGroupsStore.set([]);
  });

  it("renders GroupDashboardSettings for a settings contribution workspace", () => {
    workspaceGroupsStore.set([
      {
        id: "g1",
        name: "My Group",
        path: "/tmp/g1",
        color: "purple",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-04-21T00:00:00.000Z",
      },
    ]);

    const ws: Workspace = {
      id: "ws-settings",
      name: "Settings",
      splitRoot: { type: "pane", pane: makePane("p1") },
      activePaneId: "p1",
      metadata: {
        isDashboard: true,
        groupId: "g1",
        dashboardContributionId: "settings",
      },
    } as unknown as Workspace;
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    const pane = (ws.splitRoot as { type: "pane"; pane: Pane }).pane;
    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: ws.id,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const panel = container.querySelector<HTMLElement>(
      "[data-group-dashboard-settings]",
    );
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("data-group-id")).toBe("g1");
    // No tab strip — Settings is its own dashboard now.
    expect(container.querySelector("[data-group-dashboard-tabs]")).toBeNull();
  });
});
