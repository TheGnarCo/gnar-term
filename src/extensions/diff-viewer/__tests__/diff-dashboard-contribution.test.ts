/**
 * diff-viewer registers a per-group Diff dashboard contribution. When
 * the extension activates, the contribution appears in the dashboard
 * registry; invoking `create(group)` materializes a workspace backed
 * by a `diff-viewer:diff` surface pointed at the group's repo.
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
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../../../lib/stores/workspace";
import { resetSurfaceTypes } from "../../../lib/services/surface-type-registry";
import { resetCommands } from "../../../lib/services/command-registry";

describe("Diff dashboard contribution", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetSurfaceTypes();
    resetDashboardContributions();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("registers a 'diff' dashboard contribution on activation", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const contribs = get(dashboardContributionStore);
    const diff = contribs.find((c) => c.id === "diff");
    expect(diff).toBeTruthy();
    expect(diff?.label).toBe("Diff");
    expect(diff?.source).toBe("diff-viewer");
    expect(diff?.capPerGroup).toBe(1);
    expect(diff?.paneConstraints?.singleSurface).toBe(true);
    expect(diff?.autoProvision).toBeFalsy();
    expect(diff?.icon).toBeDefined();
  });

  it("create(group) materializes a workspace with a diff-viewer:diff surface", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    expect(diff).toBeTruthy();

    await diff!.create({
      id: "g1",
      name: "My Group",
      path: "/tmp/my-group",
      color: "blue",
      workspaceIds: [],
      isGit: true,
      createdAt: "2026-04-21T00:00:00.000Z",
    });

    const all = get(nestedWorkspaces);
    const created = all.find(
      (w) => w.metadata?.dashboardContributionId === "diff",
    );
    expect(created).toBeTruthy();
    expect(created!.metadata?.isDashboard).toBe(true);
    expect(created!.metadata?.groupId).toBe("g1");
  });
});
