/**
 * Pins the registered shape of the Spacebase per-workspace dashboard
 * contribution and the body's hidden surface type. Mirrors the test
 * pattern used by diff-viewer's diff-dashboard-contribution.test.ts.
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

  it("registers a 'workspace-dashboard' contribution on activation", async () => {
    registerExtension(spacebaseManifest, registerSpacebaseExtension);
    await activateExtension("spacebase");

    const contrib = get(dashboardContributionStore).find(
      (c) => c.id === "workspace-dashboard",
    );
    expect(contrib).toBeTruthy();
    expect(contrib?.label).toBe("Spacebase");
    expect(contrib?.actionLabel).toBe("Add Spacebase Dashboard");
    expect(contrib?.source).toBe("spacebase");
    expect(contrib?.capPerWorkspace).toBe(1);
    // Opt-in (matches architecture.md): user must explicitly add it from
    // the workspace's "Add Dashboard" menu — not auto-provisioned and
    // not default-on.
    expect(contrib?.autoProvision).toBeFalsy();
    expect(contrib?.defaultEnabled).toBeFalsy();
    expect(contrib?.icon).toBeDefined();
  });

  it("registers the dashboard body as a hidden surface type", async () => {
    registerExtension(spacebaseManifest, registerSpacebaseExtension);
    await activateExtension("spacebase");

    const surface = get(surfaceTypeStore).find(
      (s) => s.id === "spacebase:workspace-dashboard",
    );
    expect(surface).toBeTruthy();
    expect(surface?.hideFromNewSurface).toBe(true);
    expect(surface?.source).toBe("spacebase");
  });

  it("create(workspace) materializes a dashboard workspace tagged with the contribution", async () => {
    registerExtension(spacebaseManifest, registerSpacebaseExtension);
    await activateExtension("spacebase");

    const contrib = get(dashboardContributionStore).find(
      (c) => c.id === "workspace-dashboard",
    );
    expect(contrib).toBeTruthy();

    await contrib!.create({
      id: "g1",
      name: "My Workspace",
      path: "/tmp/my-workspace",
      color: "blue",
      branchedWorkspaceIds: [],
      isGit: true,
      createdAt: "2026-04-21T00:00:00.000Z",
    });

    const created = get(workspaces).find(
      (w) => w.dashboardContributionId === "workspace-dashboard",
    );
    expect(created).toBeTruthy();
    expect(created!.isDashboard).toBe(true);
    expect(created!.rootWorkspaceId).toBe("g1");

    const panes = (
      created!.paneLayout as unknown as {
        pane: {
          surfaces: Array<{
            kind: string;
            surfaceTypeId?: string;
            props?: Record<string, unknown>;
          }>;
        };
      }
    ).pane.surfaces;
    expect(panes).toHaveLength(1);
    expect(panes[0]?.kind).toBe("registry");
    expect(panes[0]?.surfaceTypeId).toBe("spacebase:workspace-dashboard");
    expect(panes[0]?.props).toEqual({ rootWorkspaceId: "g1" });
  });
});
