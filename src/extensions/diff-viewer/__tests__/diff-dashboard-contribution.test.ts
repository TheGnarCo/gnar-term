/**
 * diff-viewer registers a per-workspace Diff dashboard contribution. The
 * contribution is `defaultEnabled`: a tab is back-filled into every
 * existing workspace by default but the user can dismiss it from the
 * workspace's Settings panel. These tests pin the registered shape
 * (defaultEnabled set, no autoProvision / lockedReason), verify that
 * `openAsTab` stamps a registry surface tagged with
 * `dashboardContributionId: "diff"` onto the workspace's primary pane,
 * verify that activation back-fills existing workspaces, and that
 * `dismissedDashboardContributionIds` is respected.
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

function hasDashboardTab(rootId: string, contributionId: string): boolean {
  const ws = get(workspaces).find((w) => w.id === rootId);
  if (!ws) return false;
  const layout = ws.paneLayout as unknown as {
    pane: {
      surfaces: Array<{ kind: string; dashboardContributionId?: string }>;
    };
  };
  return layout.pane.surfaces.some(
    (s) =>
      s.kind === "registry" && s.dashboardContributionId === contributionId,
  );
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

  it("openAsTab(workspace) stamps a Diff dashboard tab onto the workspace's pane", async () => {
    workspaces.set([seedRoot("g1", "blue")]);
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    expect(diff).toBeTruthy();

    await diff!.openAsTab(
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
      (s) => s.dashboardContributionId === "diff",
    );
    expect(dashTabs).toHaveLength(1);
    const tab = dashTabs[0]!;
    expect(tab.kind).toBe("registry");
    expect(tab.surfaceTypeId).toBe("dashboard:diff");
    expect(tab.props).toEqual({ rootWorkspaceId: "g1" });
  });

  it("back-fills the Diff Dashboard tab onto existing workspaces on activate", async () => {
    workspaces.set([seedRoot("g1", "blue"), seedRoot("g2", "green")]);
    markRestored();

    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    await new Promise((r) => setTimeout(r, 50));

    expect(hasDashboardTab("g1", "diff")).toBe(true);
    expect(hasDashboardTab("g2", "diff")).toBe(true);
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

    expect(hasDashboardTab("g1", "diff")).toBe(false);
    expect(hasDashboardTab("g2", "diff")).toBe(true);
  });
});
