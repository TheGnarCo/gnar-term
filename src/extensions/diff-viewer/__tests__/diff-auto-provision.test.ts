/**
 * Tests for the diff-viewer auto-provision behavior:
 * - The diff dashboard contribution is registered with autoProvision: true
 *   and a lockedReason.
 * - isAvailableFor returns true for git groups, false for non-git groups.
 * - After activation + markRestored(), a diff dashboard workspace is created
 *   for each git workspace group in the store.
 * - After deactivation, auto-provisioned dashboards are removed.
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
  workspaceSubtitleStore,
  resetWorkspaceSubtitles,
} from "../../../lib/services/workspace-subtitle-registry";
import {
  registerExtension,
  activateExtension,
  deactivateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";
import { resetSurfaceTypes } from "../../../lib/services/surface-type-registry";
import { resetCommands } from "../../../lib/services/command-registry";
import {
  setWorkspaceGroups,
  resetWorkspaceGroupsForTest,
} from "../../../lib/stores/workspace-groups";
import {
  markRestored,
  resetRestoreSignal,
} from "../../../lib/bootstrap/restore-workspaces";

function makeGitGroup(id: string, path = `/repos/${id}`) {
  return {
    id,
    name: `Group ${id}`,
    path,
    color: "blue",
    isGit: true,
    workspaceIds: [],
    createdAt: new Date().toISOString(),
  };
}

function makeNonGitGroup(id: string) {
  return {
    id,
    name: `Group ${id}`,
    path: `/projects/${id}`,
    color: "gray",
    isGit: false,
    workspaceIds: [],
    createdAt: new Date().toISOString(),
  };
}

describe("Diff dashboard auto-provision", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetCommands();
    resetSurfaceTypes();
    resetDashboardContributions();
    resetWorkspaceSubtitles();
    resetWorkspaceGroupsForTest();
    resetRestoreSignal();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    vi.clearAllMocks();
  });

  // --- Contribution shape ---

  it("contribution has autoProvision: true", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    expect(diff?.autoProvision).toBe(true);
  });

  it("contribution has lockedReason set", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    expect(diff?.lockedReason).toBeTruthy();
    expect(typeof diff?.lockedReason).toBe("string");
  });

  it("isAvailableFor returns true for git groups", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    const gitGroup = makeGitGroup("g1");
    expect(diff?.isAvailableFor?.(gitGroup)).toBe(true);
  });

  it("isAvailableFor returns false for non-git groups", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    const nonGitGroup = makeNonGitGroup("g2");
    expect(diff?.isAvailableFor?.(nonGitGroup)).toBe(false);
  });

  // --- Subtitle registration ---

  it("registers DiffStatLine as a workspace subtitle at priority 15", async () => {
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const subtitles = get(workspaceSubtitleStore);
    const diffSubtitle = subtitles.find(
      (s) => s.source === "diff-viewer" && s.priority === 15,
    );
    expect(diffSubtitle).toBeDefined();
    expect(diffSubtitle!.component).toBeTruthy();
  });

  // --- Backfill provision loop ---

  it("provisions a diff dashboard for each git group after markRestored()", async () => {
    setWorkspaceGroups([makeGitGroup("g1"), makeGitGroup("g2")]);

    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    // Trigger the waitRestored() gate
    markRestored();

    // Drain microtasks for the async backfill loop
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const all = get(workspaces);
    const diffDashboards = all.filter((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      return md?.isDashboard === true && md?.dashboardContributionId === "diff";
    });
    expect(diffDashboards.length).toBe(2);
    const groupIds = diffDashboards.map(
      (w) => (w.metadata as Record<string, unknown>).groupId,
    );
    expect(groupIds).toContain("g1");
    expect(groupIds).toContain("g2");
  });

  it("isAvailableFor correctly gates availability (UI gate, not provisioning)", async () => {
    // isAvailableFor is a UI-level gate used to hide the "Add Diff Dashboard"
    // menu entry for non-git groups. The auto-provision backfill loop in
    // index.ts calls provisionAutoDashboardsForGroup for ALL groups; the
    // function itself does not re-check isAvailableFor.
    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    const diff = get(dashboardContributionStore).find((c) => c.id === "diff");
    expect(diff?.isAvailableFor?.(makeGitGroup("g1"))).toBe(true);
    expect(diff?.isAvailableFor?.(makeNonGitGroup("g2"))).toBe(false);
  });

  it("does not provision a second dashboard when one already exists for the group", async () => {
    setWorkspaceGroups([makeGitGroup("g1")]);

    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    markRestored();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const countAfterFirst = get(workspaces).filter((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      return md?.isDashboard === true && md?.dashboardContributionId === "diff";
    }).length;
    expect(countAfterFirst).toBe(1);

    // Triggering again (simulate a second activate cycle) should not duplicate
    markRestored();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const countAfterSecond = get(workspaces).filter((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      return md?.isDashboard === true && md?.dashboardContributionId === "diff";
    }).length;
    expect(countAfterSecond).toBe(1);
  });

  // --- Deactivation cleanup ---

  it("removes auto-provisioned dashboards on deactivation", async () => {
    setWorkspaceGroups([makeGitGroup("g1")]);

    registerExtension(diffViewerManifest, registerDiffViewerExtension);
    await activateExtension("diff-viewer");

    markRestored();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Verify dashboards exist
    expect(
      get(workspaces).some((w) => {
        const md = w.metadata as Record<string, unknown> | undefined;
        return (
          md?.isDashboard === true && md?.dashboardContributionId === "diff"
        );
      }),
    ).toBe(true);

    deactivateExtension("diff-viewer");

    // Drain cleanup microtasks
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const remaining = get(workspaces).filter((w) => {
      const md = w.metadata as Record<string, unknown> | undefined;
      return md?.isDashboard === true && md?.dashboardContributionId === "diff";
    });
    expect(remaining.length).toBe(0);
  });
});
