import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/services/workspace-runtime-service", () => ({
  createWorkspaceFromDef: vi.fn().mockResolvedValue("new-ws-id"),
  switchWorkspace: vi.fn(),
}));

// Minimal mock of the workspaces store — tests override subscribe per-test.
const mockWorkspacesValue: unknown[] = [];
vi.mock("../lib/stores/workspace", () => ({
  workspaces: {
    subscribe: vi.fn((cb: (v: unknown[]) => void) => {
      cb(mockWorkspacesValue);
      return () => {};
    }),
  },
}));

vi.mock("../lib/services/service-helpers", () => ({}));

import {
  registerGlobalSurface,
  unregisterGlobalSurface,
  spawnOrNavigate,
  globalSurfaceRegistry,
  clearGlobalSurfaceRegistry,
} from "../lib/services/global-surface-service";
import {
  createWorkspaceFromDef,
  switchWorkspace,
} from "../lib/services/workspace-runtime-service";
import { workspaces } from "../lib/stores/workspace";

const MockIcon = {} as unknown as import("svelte").Component;
const MockComponent = {} as unknown as import("svelte").Component;

function makeEntry(id = "ext:foo") {
  return { id, label: "Foo", icon: MockIcon, component: MockComponent };
}

describe("registerGlobalSurface", () => {
  beforeEach(() => clearGlobalSurfaceRegistry());

  it("adds entry to registry store", () => {
    registerGlobalSurface(makeEntry("ext:foo"));
    expect(get(globalSurfaceRegistry).get("ext:foo")).toBeDefined();
  });

  it("overwrites duplicate id", () => {
    registerGlobalSurface(makeEntry("ext:foo"));
    registerGlobalSurface({ ...makeEntry("ext:foo"), label: "Bar" });
    expect(get(globalSurfaceRegistry).get("ext:foo")!.label).toBe("Bar");
  });
});

describe("unregisterGlobalSurface", () => {
  beforeEach(() => clearGlobalSurfaceRegistry());

  it("removes entry from registry", () => {
    registerGlobalSurface(makeEntry("ext:foo"));
    unregisterGlobalSurface("ext:foo");
    expect(get(globalSurfaceRegistry).get("ext:foo")).toBeUndefined();
  });
});

describe("getGlobalSurfaceEntry (via globalSurfaceRegistry)", () => {
  beforeEach(() => clearGlobalSurfaceRegistry());

  it("returns undefined for unknown id", () => {
    expect(get(globalSurfaceRegistry).get("ext:unknown")).toBeUndefined();
  });

  it("returns entry after registration", () => {
    registerGlobalSurface(makeEntry("ext:foo"));
    expect(get(globalSurfaceRegistry).get("ext:foo")?.label).toBe("Foo");
  });
});

describe("spawnOrNavigate", () => {
  beforeEach(() => {
    clearGlobalSurfaceRegistry();
    vi.clearAllMocks();
  });

  it("does nothing for unregistered id", async () => {
    await spawnOrNavigate("ext:nonexistent");
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("creates workspace when none exists", async () => {
    vi.mocked(workspaces).subscribe = vi.fn((cb) => {
      cb([]);
      return () => {};
    });
    registerGlobalSurface(makeEntry("ext:foo"));
    await spawnOrNavigate("ext:foo");
    // The created workspace seeds a single hidden global surface
    // (`dashboard:ext:foo` — prefix preserved for persisted-data
    // compatibility) so PaneView's standard registry-surface render
    // path mounts the surface component.
    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Foo",
        layout: {
          pane: {
            surfaces: [
              {
                type: "registry",
                extensionType: "dashboard:ext:foo",
                name: "Foo",
                focus: true,
              },
            ],
          },
        },
        dashboardContributionId: "ext:foo",
        isDashboard: true,
      }),
    );
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("switches to existing workspace instead of creating", async () => {
    vi.mocked(workspaces).subscribe = vi.fn((cb) => {
      cb([
        {
          id: "ws-1",
          dashboardContributionId: "ext:foo",
          isDashboard: true,
        },
      ]);
      return () => {};
    });
    registerGlobalSurface(makeEntry("ext:foo"));
    await spawnOrNavigate("ext:foo");
    expect(switchWorkspace).toHaveBeenCalledWith(0);
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });
});
