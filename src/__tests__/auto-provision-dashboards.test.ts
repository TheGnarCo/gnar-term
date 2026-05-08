/**
 * provisionAutoDashboardsForWorkspace — called on workspace create and on startup
 * reconciliation. Iterates every registered DashboardContribution with
 * `autoProvision: true` (and `defaultEnabled: true` unless dismissed), then
 * invokes `contribution.openAsTab(workspace, { activate: false })` so each
 * dashboard becomes a tab in the workspace's pane. Idempotent — `openAsTab`
 * dedupes via the surface registry's matchProps.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";
import { provisionAutoDashboardsForWorkspace } from "../lib/services/workspace-service";
import type { Workspace } from "../lib/config";

function makeWorkspace(id: string): Workspace {
  return {
    id,
    name: `Workspace `,
    path: `/tmp/${id}`,
    color: "purple",
    branchedWorkspaceIds: [],
    isGit: false,
    createdAt: "2026-04-21T00:00:00.000Z",
  };
}

describe("provisionAutoDashboardsForWorkspace", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetDashboardContributions();
  });

  it("calls openAsTab for every autoProvision contribution and skips opt-in ones", async () => {
    const aOpen = vi.fn(async () => {});
    const bOpen = vi.fn(async () => {});
    const cOpen = vi.fn(async () => {});
    registerDashboardContribution({
      id: "a",
      source: "core",
      label: "A",
      actionLabel: "Add A",
      capPerWorkspace: 1,
      autoProvision: true,
      openAsTab: aOpen,
    });
    registerDashboardContribution({
      id: "b",
      source: "core",
      label: "B",
      actionLabel: "Add B",
      capPerWorkspace: 1,
      autoProvision: true,
      openAsTab: bOpen,
    });
    registerDashboardContribution({
      id: "c",
      source: "core",
      label: "C",
      actionLabel: "Add C",
      capPerWorkspace: 1,
      // Neither autoProvision nor defaultEnabled — must NOT auto-open.
      openAsTab: cOpen,
    });

    const workspace = makeWorkspace("g1");
    await provisionAutoDashboardsForWorkspace(workspace);

    expect(aOpen).toHaveBeenCalledWith(workspace, { activate: false });
    expect(bOpen).toHaveBeenCalledWith(workspace, { activate: false });
    expect(cOpen).not.toHaveBeenCalled();
  });

  it("opens defaultEnabled contributions unless the workspace dismissed them", async () => {
    const dOpen = vi.fn(async () => {});
    const eOpen = vi.fn(async () => {});
    registerDashboardContribution({
      id: "d",
      source: "ext",
      label: "D",
      actionLabel: "Add D",
      capPerWorkspace: 1,
      defaultEnabled: true,
      openAsTab: dOpen,
    });
    registerDashboardContribution({
      id: "e",
      source: "ext",
      label: "E",
      actionLabel: "Add E",
      capPerWorkspace: 1,
      defaultEnabled: true,
      openAsTab: eOpen,
    });

    const workspace = makeWorkspace("g1");
    (
      workspace as Workspace & { dismissedDashboardContributionIds?: string[] }
    ).dismissedDashboardContributionIds = ["d"];

    await provisionAutoDashboardsForWorkspace(workspace);

    expect(dOpen).not.toHaveBeenCalled();
    expect(eOpen).toHaveBeenCalledWith(workspace, { activate: false });
  });

  it("swallows errors from one contribution so others still get provisioned", async () => {
    const aOpen = vi.fn(async () => {
      throw new Error("boom");
    });
    const bOpen = vi.fn(async () => {});
    registerDashboardContribution({
      id: "a",
      source: "core",
      label: "A",
      actionLabel: "Add A",
      capPerWorkspace: 1,
      autoProvision: true,
      openAsTab: aOpen,
    });
    registerDashboardContribution({
      id: "b",
      source: "core",
      label: "B",
      actionLabel: "Add B",
      capPerWorkspace: 1,
      autoProvision: true,
      openAsTab: bOpen,
    });

    const workspace = makeWorkspace("g1");
    await expect(
      provisionAutoDashboardsForWorkspace(workspace),
    ).resolves.toBeUndefined();
    expect(aOpen).toHaveBeenCalled();
    expect(bOpen).toHaveBeenCalled();
  });
});
