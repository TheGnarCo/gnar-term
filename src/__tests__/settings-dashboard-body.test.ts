/**
 * PaneView renders the shared `WorkspaceDashboardSettings` body for a
 * settings dashboard workspace via the unified surface pipeline: the
 * dashboard seeds a `core:workspace-settings` registry surface, and
 * PaneView renders it the same way it renders any other registered
 * surface type. No early-return / bypass code path is special-cased
 * for Settings.
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
import WorkspaceDashboardSettings from "../lib/components/WorkspaceDashboardSettings.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  registerSurfaceType,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";
import type { Workspace, Pane, RegistrySurface } from "../lib/types";

function makePane(id: string, surfaces: RegistrySurface[] = []): Pane {
  return {
    id,
    surfaces,
    activeSurfaceId: surfaces[0]?.id ?? null,
  } as unknown as Pane;
}

const noop = () => {};

describe("PaneView — settings dashboard body", () => {
  beforeEach(() => {
    cleanup();
    resetSurfaceTypes();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("renders WorkspaceDashboardSettings via the registry surface pipeline", () => {
    registerSurfaceType({
      id: "core:workspace-settings",
      label: "Workspace Settings",
      component: WorkspaceDashboardSettings,
      source: "core",
      hideFromNewSurface: true,
    });

    const root: Workspace = {
      id: "g1",
      name: "My Workspace",
      path: "/tmp/g1",
      color: "purple",
      branchedWorkspaceIds: [],
      isGit: false,
      createdAt: "2026-04-21T00:00:00.000Z",
      paneLayout: { type: "pane", pane: makePane("g1-p") },
      activePaneId: "g1-p",
    } as unknown as Workspace;

    const settingsSurface: RegistrySurface = {
      kind: "registry",
      id: "s1",
      surfaceTypeId: "core:workspace-settings",
      title: "Settings",
      hasUnread: false,
      props: { rootWorkspaceId: "g1" },
    };

    const ws: Workspace = {
      id: "ws-settings",
      name: "Settings",
      paneLayout: { type: "pane", pane: makePane("p1", [settingsSurface]) },
      activePaneId: "p1",
      isDashboard: true,
      rootWorkspaceId: "g1",
      dashboardContributionId: "settings",
    } as unknown as Workspace;
    workspaces.set([root, ws]);
    activeWorkspaceIdx.set(1);

    const pane = (ws.paneLayout as { type: "pane"; pane: Pane }).pane;
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
      "[data-workspace-dashboard-settings]",
    );
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("data-workspace-id")).toBe("g1");
  });
});
