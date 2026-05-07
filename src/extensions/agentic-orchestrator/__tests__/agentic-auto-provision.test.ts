/**
 * Agentic Dashboard contribution registration. Only the Settings
 * dashboard auto-provisions on every workspace by default; the Agentic
 * Dashboard is opt-in via the workspace's Settings panel toggle. These
 * tests pin the registered shape (icon present, no autoProvision /
 * lockedReason) and verify that activation does NOT eagerly back-fill
 * existing workspaces with an agentic dashboard.
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

describe("agentic auto-provision", () => {
  beforeEach(async () => {
    resetRestoreSignal();
    await resetExtensions();
    resetDashboardContributions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("contribution registers as opt-in (no autoProvision / lockedReason)", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const contribution = getDashboardContribution("agentic");
    expect(contribution).toBeDefined();
    expect(contribution?.autoProvision).toBeFalsy();
    expect(contribution?.lockedReason).toBeUndefined();
    expect(contribution?.icon).toBeDefined();
  });

  it("does NOT back-fill the Agentic Dashboard onto existing workspaces on activate", async () => {
    workspaces.set([seedRoot("g1", "blue"), seedRoot("g2", "green")]);
    // Simulate workspaces already restored (runtime-enable path).
    markRestored();

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    // Drain any deferred microtasks the registry might queue.
    await new Promise((r) => setTimeout(r, 50));

    const hasAnyAgenticDashboard = get(workspaces).some(
      (w) => w.dashboardContributionId === "agentic",
    );
    expect(hasAnyAgenticDashboard).toBe(false);
  });
});
