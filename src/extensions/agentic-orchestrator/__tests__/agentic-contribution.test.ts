/**
 * Stage 7: verifies the Agentic Dashboard contribution is registered
 * via the DashboardContributionRegistry when the extension activates,
 * tear-down on deactivate, and that its `create` hook materializes a
 * dashboard workspace with the expected metadata shape.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

const { createWorkspaceFromDefMock } = vi.hoisted(() => ({
  createWorkspaceFromDefMock: vi.fn(async () => "ws-agentic-new"),
}));
vi.mock("../../../lib/services/nested-workspace-service", () => ({
  createNestedWorkspaceFromDef: createWorkspaceFromDefMock,
  closeNestedWorkspace: vi.fn(),
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

describe("agentic extension — Dashboard contribution registration", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetDashboardContributions();
    createWorkspaceFromDefMock.mockClear();
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

  it("create(workspace) materializes a dashboard nested workspace with agentic metadata", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const contribution = getDashboardContribution("agentic");
    expect(contribution).toBeDefined();

    const workspaceId = await contribution!.create({
      id: "grp-1",
      name: "Example",
      path: "/work/proj",
      color: "blue",
      isGit: true,
    });

    expect(workspaceId).toBe("ws-agentic-new");
    expect(createWorkspaceFromDefMock).toHaveBeenCalledTimes(1);
    const def = createWorkspaceFromDefMock.mock.calls[0]![0] as {
      name: string;
      layout: { pane: { surfaces: Array<{ type: string; path: string }> } };
      metadata: Record<string, unknown>;
    };
    expect(def.name).toBe("Agents");
    expect(def.layout.pane.surfaces[0]?.type).toBe("preview");
    expect(def.layout.pane.surfaces[0]?.path).toBe(
      "/work/proj/.gnar-term/agentic-dashboard.md",
    );
    expect(def.metadata).toMatchObject({
      isDashboard: true,
      parentWorkspaceId: "grp-1",
      dashboardContributionId: "agentic",
    });
  });
});
