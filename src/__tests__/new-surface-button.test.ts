/**
 * Tests for NewSurfaceButton — the "+" button with conditional dropdown
 * in the tab bar for creating different surface types.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  registerSurfaceType,
  resetSurfaceTypes,
  surfaceTypeStore,
} from "../lib/services/surface-type-registry";
import {
  registerAgentLauncher,
  resetAgentLaunchers,
  agentLauncherStore,
  unregisterAgentLaunchersBySource,
} from "../lib/services/agent-launcher-registry";

describe("NewSurfaceButton data source — surface types", () => {
  beforeEach(() => {
    resetSurfaceTypes();
  });

  it("surfaceTypeStore is empty by default — no caret should show", () => {
    expect(get(surfaceTypeStore)).toHaveLength(0);
  });

  it("registering a surface type makes store non-empty — caret should show", () => {
    registerSurfaceType({
      id: "preview",
      label: "Preview",
      component: {},
      source: "preview-ext",
    });
    expect(get(surfaceTypeStore)).toHaveLength(1);
    expect(get(surfaceTypeStore)[0].label).toBe("Preview");
  });

  it("registering multiple surface types populates dropdown items", () => {
    registerSurfaceType({
      id: "preview",
      label: "Preview",
      component: {},
      source: "preview-ext",
    });
    registerSurfaceType({
      id: "diff",
      label: "Diff Viewer",
      component: {},
      source: "diff-ext",
    });
    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(2);
    expect(types.map((t) => t.id)).toEqual(["preview", "diff"]);
  });

  it("unregistering surface types removes dropdown items", () => {
    registerSurfaceType({
      id: "preview",
      label: "Preview",
      component: {},
      source: "preview-ext",
    });
    expect(get(surfaceTypeStore)).toHaveLength(1);

    resetSurfaceTypes();
    expect(get(surfaceTypeStore)).toHaveLength(0);
  });
});

describe("NewSurfaceButton data source — agent launchers", () => {
  beforeEach(() => {
    resetAgentLaunchers();
  });

  it("agentLauncherStore is empty by default", () => {
    expect(get(agentLauncherStore)).toHaveLength(0);
  });

  it("registering an agent launcher populates the store", () => {
    registerAgentLauncher({
      id: "orchestrator:agent-claude",
      label: "Claude Code",
      command: "claude",
      source: "agentic-orchestrator",
    });
    const launchers = get(agentLauncherStore);
    expect(launchers).toHaveLength(1);
    expect(launchers[0].label).toBe("Claude Code");
    expect(launchers[0].command).toBe("claude");
  });

  it("registering multiple launchers from different extensions", () => {
    registerAgentLauncher({
      id: "ext-a:agent-1",
      label: "Agent A",
      command: "agent-a",
      source: "ext-a",
    });
    registerAgentLauncher({
      id: "ext-b:agent-2",
      label: "Agent B",
      command: "agent-b",
      source: "ext-b",
    });
    expect(get(agentLauncherStore)).toHaveLength(2);
  });

  it("unregisterBySource only removes launchers from that extension", () => {
    registerAgentLauncher({
      id: "ext-a:agent-1",
      label: "Agent A",
      command: "agent-a",
      source: "ext-a",
    });
    registerAgentLauncher({
      id: "ext-b:agent-2",
      label: "Agent B",
      command: "agent-b",
      source: "ext-b",
    });
    expect(get(agentLauncherStore)).toHaveLength(2);

    unregisterAgentLaunchersBySource("ext-a");
    const remaining = get(agentLauncherStore);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("ext-b:agent-2");
  });
});

describe("newSurfaceWithCommand", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("is exported from surface-service", async () => {
    const mod = await import("../lib/services/surface-service");
    expect(mod.newSurfaceWithCommand).toBeTypeOf("function");
  });

  it("openExtensionSurfaceInPaneById is exported from surface-service", async () => {
    const mod = await import("../lib/services/surface-service");
    expect(mod.openExtensionSurfaceInPaneById).toBeTypeOf("function");
  });
});
