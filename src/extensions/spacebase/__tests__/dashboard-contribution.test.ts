/**
 * Pins the registered shape of the Spacebase per-workspace dashboard
 * contribution and the body's hidden global surface type. The
 * contribution opens as a tab inside the host workspace via
 * `openAsTab` (the post-9363fcd dashboards-as-tabs API); the surface
 * is registered globally so the tab can mount in any workspace.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { spacebaseManifest, registerSpacebaseExtension } from "../index";
import {
  dashboardContributionStore,
  resetDashboardContributions,
} from "../../../lib/services/dashboard-contribution-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";
import {
  resetSurfaceTypes,
  surfaceTypeStore,
} from "../../../lib/services/surface-type-registry";
import { resetCommands } from "../../../lib/services/command-registry";
import { resetRestoreSignal } from "../../../lib/bootstrap/restore-workspaces";

function seedRoot(
  id: string,
  color: string,
): import("../../../lib/types").Workspace {
  return {
    id,
    name: id.toUpperCase(),
    path: `/tmp/${id}`,
    color,
    branchedWorkspaceIds: [],
    isGit: true,
    createdAt: "2026-04-21T00:00:00.000Z",
    paneLayout: {
      type: "pane",
      pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `${id}-p`,
  } as unknown as import("../../../lib/types").Workspace;
}

describe("Spacebase workspace dashboard contribution", () => {
  beforeEach(async () => {
    resetRestoreSignal();
    await resetExtensions();
    resetCommands();
    resetSurfaceTypes();
    resetDashboardContributions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("registers a 'spacebase-dashboard' contribution on activation", async () => {
    registerExtension(spacebaseManifest, registerSpacebaseExtension);
    await activateExtension("spacebase");

    const contrib = get(dashboardContributionStore).find(
      (c) => c.id === "spacebase-dashboard",
    );
    expect(contrib).toBeTruthy();
    expect(contrib?.label).toBe("Spacebase");
    expect(contrib?.actionLabel).toBe("Add Spacebase Dashboard");
    expect(contrib?.source).toBe("spacebase");
    expect(contrib?.capPerWorkspace).toBe(1);
    // Default-on: the contribution back-fills onto every workspace when
    // the extension activates and tears down on deactivate via the
    // registry's auto-dashboard cleanup. Users can dismiss per-workspace
    // from Workspace Settings.
    expect(contrib?.autoProvision).toBeFalsy();
    expect(contrib?.defaultEnabled).toBe(true);
    expect(contrib?.icon).toBeDefined();
  });

  it("registers the dashboard body as a hidden, extension-namespaced surface type", async () => {
    registerExtension(spacebaseManifest, registerSpacebaseExtension);
    await activateExtension("spacebase");

    const surface = get(surfaceTypeStore).find(
      (s) => s.id === "spacebase:spacebase-dashboard",
    );
    expect(surface).toBeTruthy();
    expect(surface?.hideFromNewSurface).toBe(true);
    expect(surface?.source).toBe("spacebase");
  });

  it("openAsTab(workspace) stamps a Spacebase dashboard tab onto the workspace's pane", async () => {
    workspaces.set([seedRoot("g1", "blue")]);
    registerExtension(spacebaseManifest, registerSpacebaseExtension);
    await activateExtension("spacebase");

    const contrib = get(dashboardContributionStore).find(
      (c) => c.id === "spacebase-dashboard",
    );
    expect(contrib).toBeTruthy();

    await contrib!.openAsTab(
      {
        id: "g1",
        name: "My Workspace",
        path: "/tmp/my-workspace",
        color: "blue",
        branchedWorkspaceIds: [],
        isGit: true,
        createdAt: "2026-04-21T00:00:00.000Z",
      } as unknown as import("../../../lib/stores/workspace").RootWorkspace,
      { activate: false },
    );

    const ws = get(workspaces).find((w) => w.id === "g1");
    expect(ws).toBeDefined();
    const surfaces = (
      ws!.paneLayout as unknown as {
        pane: {
          surfaces: Array<{
            kind: string;
            surfaceTypeId?: string;
            props?: Record<string, unknown>;
            dashboardContributionId?: string;
          }>;
        };
      }
    ).pane.surfaces;
    const dashTabs = surfaces.filter(
      (s) => s.dashboardContributionId === "spacebase-dashboard",
    );
    expect(dashTabs).toHaveLength(1);
    const tab = dashTabs[0]!;
    expect(tab.kind).toBe("registry");
    expect(tab.surfaceTypeId).toBe("spacebase:spacebase-dashboard");
    expect(tab.props).toEqual({ rootWorkspaceId: "g1" });
  });
});
