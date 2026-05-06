/**
 * Agentic auto-provision (Story 4): on activate, every existing
 * workspace gets an Agentic Dashboard child workspace; on deactivate,
 * the provisioned workspaces are closed.
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
  deactivateExtension,
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
    splitRoot: {
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

  it("contribution advertises autoProvision + locked reason", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const contribution = getDashboardContribution("agentic");
    expect(contribution?.autoProvision).toBe(true);
    expect(contribution?.lockedReason).toBe("Required by Agentic extension");
    expect(contribution?.icon).toBeDefined();
  });

  it("provisions the Agentic Dashboard for every existing workspace on activate", async () => {
    workspaces.set([seedRoot("g1", "blue"), seedRoot("g2", "green")]);
    // Simulate workspaces already restored (runtime-enable path).
    markRestored();

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    // Activation schedules a background provision pass — let microtasks drain.
    await new Promise((r) => setTimeout(r, 50));

    const all = get(workspaces);
    const forG1 = all.find((w) => {
      return (
        w.metadata?.dashboardContributionId === "agentic" &&
        w.metadata?.rootWorkspaceId === "g1"
      );
    });
    const forG2 = all.find((w) => {
      return (
        w.metadata?.dashboardContributionId === "agentic" &&
        w.metadata?.rootWorkspaceId === "g2"
      );
    });
    expect(forG1).toBeTruthy();
    expect(forG2).toBeTruthy();
  });

  it("closes every agentic dashboard workspace on deactivate", async () => {
    workspaces.set([seedRoot("g1", "blue")]);
    markRestored();

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    await new Promise((r) => setTimeout(r, 50));

    // Sanity: the workspace was created.
    expect(
      get(workspaces).some((w) => {
        return w.metadata?.dashboardContributionId === "agentic";
      }),
    ).toBe(true);

    deactivateExtension("agentic-orchestrator");

    expect(
      get(workspaces).some((w) => {
        return w.metadata?.dashboardContributionId === "agentic";
      }),
    ).toBe(false);
  });
});
