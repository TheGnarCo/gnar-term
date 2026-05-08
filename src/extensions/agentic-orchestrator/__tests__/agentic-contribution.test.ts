/**
 * Verifies the Agentic Dashboard contribution is registered via the
 * DashboardContributionRegistry when the extension activates, torn down
 * on deactivate, and that its `openAsTab` hook stamps a registry surface
 * tagged with `dashboardContributionId: "agentic"` onto the workspace's
 * primary pane (dashboards-as-tabs model — no separate dashboard
 * workspace).
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

function seedRoot(id: string): import("../../../lib/types").Workspace {
  return {
    id,
    name: id.toUpperCase(),
    path: `/tmp/${id}`,
    color: "blue",
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

describe("agentic extension — Dashboard contribution registration", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetDashboardContributions();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("registers an 'agentic' contribution with capPerWorkspace=1 on activate", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const contribution = getDashboardContribution("agentic");
    expect(contribution).toBeDefined();
    expect(contribution?.label).toBe("Agentic Dashboard");
    expect(contribution?.actionLabel).toBe("Add Agentic Dashboard");
    expect(contribution?.capPerWorkspace).toBe(1);
    expect(contribution?.source).toBe("agentic-orchestrator");
  });

  it("drops the contribution on deactivate", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    deactivateExtension("agentic-orchestrator");

    expect(getDashboardContribution("agentic")).toBeUndefined();
  });

  it("openAsTab(workspace) stamps a registry surface tagged with the contribution id", async () => {
    workspaces.set([seedRoot("grp-1")]);

    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const contribution = getDashboardContribution("agentic");
    expect(contribution).toBeDefined();

    await contribution!.openAsTab(
      {
        id: "grp-1",
        name: "Example",
        path: "/work/proj",
        color: "blue",
        isGit: true,
      } as unknown as import("../../../lib/stores/workspace").RootWorkspace,
      { activate: false },
    );

    const ws = get(workspaces).find((w) => w.id === "grp-1");
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
    // Idempotent: provisionAutoDashboardsForWorkspace may have already
    // back-filled the same tab on activation. Either way, exactly one
    // tab tagged with the contribution should be present.
    const dashTabs = surfaces.filter(
      (s) => s.dashboardContributionId === "agentic",
    );
    expect(dashTabs).toHaveLength(1);
    const tab = dashTabs[0]!;
    expect(tab.kind).toBe("registry");
    expect(tab.surfaceTypeId).toBe("dashboard:agentic");
    expect(tab.props).toEqual({ rootWorkspaceId: "grp-1" });
  });
});
