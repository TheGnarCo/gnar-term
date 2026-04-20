/**
 * Stage 7: verifies the Global Agentic Dashboard pseudo-workspace is
 * registered when the extension activates and unregistered on deactivate.
 * Covers registration metadata (id, position, host-metadata shape)
 * without rendering the body — the body is covered separately.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
  getPseudoWorkspace,
  resetPseudoWorkspaces,
} from "../../../lib/services/pseudo-workspace-registry";

describe("agentic extension — Global Agentic Dashboard pseudo-workspace", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetPseudoWorkspaces();
  });

  it("registers 'agentic.global' at root-top with isGlobalAgenticDashboard metadata", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const pseudo = getPseudoWorkspace("agentic.global");
    expect(pseudo).toBeDefined();
    expect(pseudo?.position).toBe("root-top");
    expect(pseudo?.label).toBe("Global Agents");
    expect(pseudo?.source).toBe("agentic-orchestrator");
    expect(pseudo?.metadata).toMatchObject({
      isGlobalAgenticDashboard: true,
    });
    expect(pseudo?.icon).toBeDefined();
    expect(pseudo?.render).toBeDefined();
  });

  it("unregisters the pseudo-workspace on deactivate", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");
    deactivateExtension("agentic-orchestrator");

    expect(getPseudoWorkspace("agentic.global")).toBeUndefined();
  });
});
