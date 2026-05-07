/**
 * Extension API workspace surface — onWorkspacesRestored lifecycle hook
 * and createWorkspaceFromDef wrapper.
 *
 * These methods exist so extensions can read or mutate the workspace
 * store without importing core internals (`waitRestored`,
 * `createWorkspaceFromDef`). The agentic-orchestrator and
 * claude-settings extensions are the primary consumers — both gate
 * back-fill loops on the restored signal and materialize dashboard
 * children via the from-def factory.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("../lib/services/workspace-runtime-service", () => ({
  createWorkspaceFromDef: vi.fn(async (def: { name?: string }) => {
    return `ws-${def.name ?? "anon"}`;
  }),
}));

import {
  markRestored,
  resetRestoreSignal,
} from "../lib/bootstrap/restore-workspaces";
import { createWorkspaceFromDef as mockedCore } from "../lib/services/workspace-runtime-service";

// The API factory builds a full ExtensionAPI; for these tests we
// exercise only the workspace-related methods. We construct a minimal
// shim by importing the action-API factory directly.

describe("ExtensionAPI workspace surface", () => {
  beforeEach(() => {
    resetRestoreSignal();
    vi.clearAllMocks();
  });

  describe("onWorkspacesRestored", () => {
    it("invokes the callback once markRestored fires", async () => {
      const { createExtensionAPI } =
        await import("../lib/services/extension-api");
      const { api } = createExtensionAPI(
        { id: "test-ext", name: "T", version: "0.0.1", entry: "x" },
        {
          stateMap: new Map(),
          eventHandlers: new Map(),
          tauriListeners: new Map(),
          watchIds: new Map(),
          stateDebounceTimers: new Map(),
          setExtensionState: () => {},
        },
      );
      const cb = vi.fn();
      api.onWorkspacesRestored(cb);

      // Microtask yield — should still be pending.
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();

      markRestored();
      await Promise.resolve();
      await Promise.resolve();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("fires immediately when restore already completed", async () => {
      markRestored();
      const { createExtensionAPI } =
        await import("../lib/services/extension-api");
      const { api } = createExtensionAPI(
        { id: "test-ext", name: "T", version: "0.0.1", entry: "x" },
        {
          stateMap: new Map(),
          eventHandlers: new Map(),
          tauriListeners: new Map(),
          watchIds: new Map(),
          stateDebounceTimers: new Map(),
          setExtensionState: () => {},
        },
      );
      const cb = vi.fn();
      api.onWorkspacesRestored(cb);
      await Promise.resolve();
      await Promise.resolve();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("disposer cancels a pending callback", async () => {
      const { createExtensionAPI } =
        await import("../lib/services/extension-api");
      const { api } = createExtensionAPI(
        { id: "test-ext", name: "T", version: "0.0.1", entry: "x" },
        {
          stateMap: new Map(),
          eventHandlers: new Map(),
          tauriListeners: new Map(),
          watchIds: new Map(),
          stateDebounceTimers: new Map(),
          setExtensionState: () => {},
        },
      );
      const cb = vi.fn();
      const dispose = api.onWorkspacesRestored(cb);
      dispose();

      markRestored();
      await Promise.resolve();
      await Promise.resolve();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("createWorkspaceFromDef", () => {
    it("forwards the def to core and resolves to the new workspace id", async () => {
      const { createExtensionAPI } =
        await import("../lib/services/extension-api");
      const { api } = createExtensionAPI(
        { id: "test-ext", name: "T", version: "0.0.1", entry: "x" },
        {
          stateMap: new Map(),
          eventHandlers: new Map(),
          tauriListeners: new Map(),
          watchIds: new Map(),
          stateDebounceTimers: new Map(),
          setExtensionState: () => {},
        },
      );
      const id = await api.createWorkspaceFromDef({
        name: "Dash",
        layout: { pane: { surfaces: [] } },
        metadata: { isDashboard: true },
      });
      expect(id).toBe("ws-Dash");
      expect(mockedCore).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Dash" }),
      );
    });
  });
});
