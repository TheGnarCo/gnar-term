/**
 * Round-trip test: activate then deactivate the agentic extension and assert
 * that deactivation leaves the action surface clean.
 *
 * The fake API tracks registrations and unregistrations manually so we can
 * assert teardown without touching core internals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writable } from "svelte/store";
import type { ExtensionAPI } from "../../api";
import { registerAgenticExtension } from "../index";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

function makeFakeApi() {
  let activateCallback: (() => void) | undefined;
  let deactivateCallback: (() => void) | undefined;

  // Tracking sets for workspace actions
  const registeredActions = new Set<string>();
  const unregisteredActions = new Set<string>();

  // Spies
  const globalSurfaceCleanup = vi.fn();
  const registerGlobalSurface = vi.fn(() => globalSurfaceCleanup);
  const registerTitleBarButton = vi.fn();
  const registerWorkspaceSubtitle = vi.fn();
  const registerChildRowContributor = vi.fn();
  const registerRootRowRenderer = vi.fn();
  const registerWorkspaceAction = vi.fn((id: string) => {
    registeredActions.add(id);
  });
  const unregisterWorkspaceAction = vi.fn((id: string) => {
    registeredActions.delete(id);
    unregisteredActions.add(id);
  });
  const getAgentByPane = vi.fn().mockReturnValue(null);

  const attention = writable<unknown[]>([]);
  const agents = writable<unknown[]>([]);
  const workspaces = writable<unknown[]>([]);

  const api = {
    onActivate: vi.fn((cb: () => void) => {
      activateCallback = cb;
    }),
    onDeactivate: vi.fn((cb: () => void) => {
      deactivateCallback = cb;
    }),
    onWorkspacesRestored: vi.fn((cb: () => void) => {
      cb();
      return () => {};
    }),
    registerGlobalSurface,
    registerTitleBarButton,
    registerWorkspaceSubtitle,
    registerChildRowContributor,
    registerRootRowRenderer,
    registerWorkspaceAction,
    unregisterWorkspaceAction,
    getAgentByPane,
    attention,
    agents,
    workspaces,
  } as unknown as ExtensionAPI;

  function activate() {
    if (!activateCallback) throw new Error("onActivate was not called");
    activateCallback();
  }

  function deactivate() {
    if (!deactivateCallback) throw new Error("onDeactivate was not called");
    deactivateCallback();
  }

  return {
    api,
    activate,
    deactivate,
    registeredActions,
    unregisteredActions,
    registerGlobalSurface,
    registerTitleBarButton,
    registerWorkspaceAction,
    unregisterWorkspaceAction,
    globalSurfaceCleanup,
  };
}

describe("registerAgenticExtension — full activation round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers both workspace actions during activation", () => {
    const fakes = makeFakeApi();
    registerAgenticExtension(fakes.api);
    fakes.activate();

    expect(fakes.registeredActions.has("spawn-agentic-branch")).toBe(true);
    expect(fakes.registeredActions.has("boot-agent-here")).toBe(true);
  });

  it("unregisters both workspace actions during deactivation", () => {
    const fakes = makeFakeApi();
    registerAgenticExtension(fakes.api);
    fakes.activate();
    fakes.deactivate();

    // After deactivate, the tracked set should be empty (actions removed)
    expect(fakes.registeredActions.has("spawn-agentic-branch")).toBe(false);
    expect(fakes.registeredActions.has("boot-agent-here")).toBe(false);
    // And unregister was explicitly called for each
    expect(fakes.unregisteredActions.has("spawn-agentic-branch")).toBe(true);
    expect(fakes.unregisteredActions.has("boot-agent-here")).toBe(true);
  });

  it("unregisterWorkspaceAction is called twice on deactivation (once per action)", () => {
    const fakes = makeFakeApi();
    registerAgenticExtension(fakes.api);
    fakes.activate();
    fakes.deactivate();

    expect(fakes.unregisterWorkspaceAction).toHaveBeenCalledTimes(2);
    const calls = (
      fakes.unregisterWorkspaceAction as ReturnType<typeof vi.fn>
    ).mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain("spawn-agentic-branch");
    expect(calls).toContain("boot-agent-here");
  });

  it("onDeactivate callback does not throw even before activate", () => {
    const fakes = makeFakeApi();
    registerAgenticExtension(fakes.api);
    // deactivate without activate — edge case
    expect(() => fakes.deactivate()).not.toThrow();
  });

  it("registerGlobalSurface is called with 'dashboard' on activation", () => {
    const fakes = makeFakeApi();
    registerAgenticExtension(fakes.api);
    fakes.activate();
    expect(fakes.registerGlobalSurface).toHaveBeenCalledWith(
      "dashboard",
      expect.objectContaining({ label: "Agentic" }),
    );
  });

  it("TitleBar button 'agentic' is registered on activation", () => {
    const fakes = makeFakeApi();
    registerAgenticExtension(fakes.api);
    fakes.activate();
    expect(fakes.registerTitleBarButton).toHaveBeenCalledWith(
      "agentic",
      expect.objectContaining({ title: "Agentic Dashboard" }),
    );
  });
});
