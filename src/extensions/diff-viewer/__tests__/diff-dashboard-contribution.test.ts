/**
 * diff-viewer registers a per-workspace Diff dashboard contribution. The
 * contribution is `defaultEnabled`: it materializes on every workspace by
 * default but the user can dismiss it from the workspace's Settings panel.
 * These tests pin the registered shape (defaultEnabled set, no autoProvision /
 * lockedReason), verify that activation back-fills existing workspaces, and
 * that `dismissedDashboardContributionIds` is respected.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { diffViewerManifest, registerDiffViewerExtension } from "../index";
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
import { resetSurfaceTypes } from "../../../lib/services/surface-type-registry";
import { resetCommands } from "../../../lib/services/command-registry";
import {
  markRestored,
  resetRestoreSignal,
} from "../../../lib/bootstrap/restore-workspaces";

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

describe("Diff dashboard contribution", () => {
  beforeEach(async () => {
    resetRestoreSignal();
    await resetExtensions();
    resetCommands();
    resetSurfaceTypes();
    resetDashboardContributions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("registers a 'diff' dashboard contribution on activation", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const contribs = get(dashboardContributionStore);
    const diff = contribs.find((c) => c.id === "diff");
    expect(diff).toBeTruthy();
    expect(diff?.label).toBe("Diff");
    expect(diff?.source).toBe("diff-viewer");
    expect(diff?.capPerWorkspace).toBe(1);
    expect(diff?.autoProvision).toBeFalsy();
    expect(diff?.defaultEnabled).toBe(true);
    expect(diff?.lockedReason).toBeUndefined();
    expect(diff?.icon).toBeDefined();
  });

  it("create(workspace) materializes a routing-only Branch tagged with the diff contribution", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    expect(diff).toBeTruthy();

    await diff!.create({
      id: "g1",
      name: "My Workspace",
      path: "/tmp/my-workspace",
      color: "blue",
      branchedWorkspaceIds: [],
      isGit: true,
      createdAt: "2026-04-21T00:00:00.000Z",
    });

    const all = get(workspaces);
    const created = all.find((w) => w.dashboardContributionId === "diff");
    expect(created).toBeTruthy();
    expect(created!.isDashboard).toBe(true);
    expect(created!.rootWorkspaceId).toBe("g1");
    // Diff Dashboard is registered as a hidden surface type
    // (`dashboard:diff`); the dashboard workspace seeds a single
    // extension surface targeting that type with `rootWorkspaceId` in
    // props so the body component can resolve the workspace via the
    // workspaces store.
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
    expect(panes[0]?.surfaceTypeId).toBe("dashboard:diff");
    expect(panes[0]?.props).toEqual({ rootWorkspaceId: "g1" });
  });

  it("back-fills the Diff Dashboard onto existing workspaces on activate", async () => {
    workspaces.set([seedRoot("g1", "blue"), seedRoot("g2", "green")]);
    markRestored();

    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    await new Promise((r) => setTimeout(r, 50));

    const diffForRoot = (rootId: string): boolean =>
      get(workspaces).some(
        (w) =>
          w.dashboardContributionId === "diff" &&
          w.rootWorkspaceId === rootId &&
          w.isDashboard === true,
      );
    expect(diffForRoot("g1")).toBe(true);
    expect(diffForRoot("g2")).toBe(true);
  });

  it("respects dismissedDashboardContributionIds and skips dismissed workspaces", async () => {
    const g1 = seedRoot("g1", "blue");
    const g2 = seedRoot("g2", "green");
    (
      g1 as { dismissedDashboardContributionIds?: string[] }
    ).dismissedDashboardContributionIds = ["diff"];
    workspaces.set([g1, g2]);
    markRestored();

    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");
    await new Promise((r) => setTimeout(r, 50));

    const diffForRoot = (rootId: string): boolean =>
      get(workspaces).some(
        (w) =>
          w.dashboardContributionId === "diff" &&
          w.rootWorkspaceId === rootId &&
          w.isDashboard === true,
      );
    expect(diffForRoot("g1")).toBe(false);
    expect(diffForRoot("g2")).toBe(true);
  });
});
