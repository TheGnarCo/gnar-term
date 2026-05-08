/**
 * Agentic Dashboard contribution registration. The Agentic Dashboard is
 * `defaultEnabled`: a tab is back-filled into every existing workspace
 * on activation, but the user can dismiss it from the workspace's
 * Settings panel. These tests pin the registered shape (icon present,
 * defaultEnabled set, no autoProvision / lockedReason) and verify that
 * activation back-fills a registry surface tagged with
 * `dashboardContributionId: "agentic"` onto each workspace's primary
 * pane.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    if (cmd === "file_exists") return false;
    if (cmd === "ensure_dir") return undefined;
    if (cmd === "write_file") return undefined;
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../../../lib/services/extension-state", () => ({
  loadExtensionState: vi.fn().mockResolvedValue({}),
  saveExtensionState: vi.fn().mockResolvedValue(undefined),
  deleteExtensionState: vi.fn().mockResolvedValue(undefined),
}));

import {
  agenticOrchestratorManifest,
  registerAgenticOrchestratorExtension,
} from "..";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";
import {
  getDashboardContribution,
  resetDashboardContributions,
} from "../../../lib/services/dashboard-contribution-registry";
import { workspaces, activeWorkspaceIdx } from "../../../lib/stores/workspace";
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

/**
 * True when the workspace's primary pane contains a registry surface
 * stamped with the given dashboardContributionId — the shape produced
 * by `openDashboardTab` / `provisionAutoDashboardsForWorkspace`.
 */
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

describe("agentic auto-provision", () => {
  beforeEach(async () => {
    resetRestoreSignal();
    await resetExtensions();
    resetDashboardContributions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("contribution registers as default-enabled (no autoProvision / lockedReason)", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const contribution = getDashboardContribution("agentic");
    expect(contribution).toBeDefined();
    expect(contribution?.autoProvision).toBeFalsy();
    expect(contribution?.defaultEnabled).toBe(true);
    expect(contribution?.lockedReason).toBeUndefined();
    expect(contribution?.icon).toBeDefined();
  });

  it("back-fills an Agentic dashboard tab onto existing workspaces on activate", async () => {
    workspaces.set([seedRoot("g1", "blue"), seedRoot("g2", "green")]);
    // Simulate workspaces already restored (runtime-enable path).
    markRestored();

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    // Drain the deferred microtasks the registry queues for back-fill.
    await new Promise((r) => setTimeout(r, 50));

    expect(hasDashboardTab("g1", "agentic")).toBe(true);
    expect(hasDashboardTab("g2", "agentic")).toBe(true);
  });

  it("respects dismissedDashboardContributionIds and skips dismissed workspaces", async () => {
    const g1 = seedRoot("g1", "blue");
    const g2 = seedRoot("g2", "green");
    (
      g1 as { dismissedDashboardContributionIds?: string[] }
    ).dismissedDashboardContributionIds = ["agentic"];
    workspaces.set([g1, g2]);
    markRestored();

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    await new Promise((r) => setTimeout(r, 50));

    expect(hasDashboardTab("g1", "agentic")).toBe(false);
    expect(hasDashboardTab("g2", "agentic")).toBe(true);
  });
});
