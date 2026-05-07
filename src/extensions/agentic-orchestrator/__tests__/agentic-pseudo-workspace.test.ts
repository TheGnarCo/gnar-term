/**
 * Verifies the Global Agentic Dashboard pseudo-workspace is registered when
 * the extension activates and unregistered on deactivate. Covers registration
 * metadata (id, position, host-metadata shape) without rendering the body.
 *
 * Also covers the close/reopen lifecycle: closing the dashboard via
 * onClose() persists state and registers a reopen action; reopening
 * via the action restores the dashboard and removes the reopen action.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

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
  unregisterPseudoWorkspace,
  resetPseudoWorkspaces,
} from "../../../lib/services/pseudo-workspace-registry";
import {
  workspaceActionStore,
  resetWorkspaceActions,
} from "../../../lib/services/workspace-action-registry";

describe("agentic extension — Global Agentic Dashboard pseudo-workspace", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetPseudoWorkspaces();
    resetWorkspaceActions();
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
    expect(pseudo?.label).toBe("Agents dashboard");
    expect(pseudo?.source).toBe("agentic-orchestrator");
    expect(pseudo?.metadata).toMatchObject({
      isGlobalAgenticDashboard: true,
    });
    expect(pseudo?.icon).toBeDefined();
    expect(pseudo?.render).toBeDefined();
  });

  it("registers 'agentic.global' with an onClose callback", async () => {
    registerExtension(
      agenticOrchestratorManifest,
      registerAgenticOrchestratorExtension,
    );
    await activateExtension("agentic-orchestrator");

    const pseudo = getPseudoWorkspace("agentic.global");
    expect(typeof pseudo?.onClose).toBe("function");
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

  describe("close/reopen lifecycle", () => {
    it("calling onClose() unregisters the pseudo-workspace and registers a reopen action", async () => {
      registerExtension(
        agenticOrchestratorManifest,
        registerAgenticOrchestratorExtension,
      );
      await activateExtension("agentic-orchestrator");

      const pseudo = getPseudoWorkspace("agentic.global");
      expect(pseudo).toBeDefined();
      expect(
        get(workspaceActionStore).find((a) =>
          a.id.includes("reopen-global-dashboard"),
        ),
      ).toBeUndefined();

      // Mirrors PseudoWorkspaceRow.handleClose: unregister first, then onClose().
      unregisterPseudoWorkspace("agentic.global");
      pseudo!.onClose!();

      expect(getPseudoWorkspace("agentic.global")).toBeUndefined();
      const reopenAction = get(workspaceActionStore).find((a) =>
        a.id.includes("reopen-global-dashboard"),
      );
      expect(reopenAction).toBeDefined();
      expect(reopenAction?.label).toBe("Agents Dashboard");
      expect(reopenAction?.zone).toBe("workspace");
    });

    it("triggering the reopen action restores the pseudo-workspace and removes the reopen action", async () => {
      registerExtension(
        agenticOrchestratorManifest,
        registerAgenticOrchestratorExtension,
      );
      await activateExtension("agentic-orchestrator");

      const pseudo = getPseudoWorkspace("agentic.global");
      unregisterPseudoWorkspace("agentic.global");
      pseudo!.onClose!();
      expect(getPseudoWorkspace("agentic.global")).toBeUndefined();

      const reopenAction = get(workspaceActionStore).find((a) =>
        a.id.includes("reopen-global-dashboard"),
      );
      expect(reopenAction).toBeDefined();
      void reopenAction!.handler({});

      expect(getPseudoWorkspace("agentic.global")).toBeDefined();
      expect(
        get(workspaceActionStore).find((a) =>
          a.id.includes("reopen-global-dashboard"),
        ),
      ).toBeUndefined();
    });

    it("does not register dashboard on activate when persisted state marks it closed", async () => {
      registerExtension(
        agenticOrchestratorManifest,
        registerAgenticOrchestratorExtension,
      );
      await activateExtension("agentic-orchestrator");
      const pseudo = getPseudoWorkspace("agentic.global");
      unregisterPseudoWorkspace("agentic.global");
      pseudo!.onClose!();
      deactivateExtension("agentic-orchestrator");
      resetPseudoWorkspaces();
      resetWorkspaceActions();

      await activateExtension("agentic-orchestrator");

      expect(getPseudoWorkspace("agentic.global")).toBeUndefined();
      expect(
        get(workspaceActionStore).find((a) =>
          a.id.includes("reopen-global-dashboard"),
        ),
      ).toBeDefined();
    });
  });
});
