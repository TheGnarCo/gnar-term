import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/services/workspace-service", () => ({
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

import {
  registerDashboardWorkspaceType,
  unregisterDashboardWorkspaceType,
  spawnOrNavigate,
  getDashboardEntry,
  dashboardWorkspaceRegistry,
  clearDashboardRegistry,
} from "../lib/services/dashboard-workspace-service";
import {
  createWorkspaceFromDef,
  switchWorkspace,
} from "../lib/services/workspace-service";
import { workspaces } from "../lib/stores/workspace";

const MockIcon = {} as unknown as import("svelte").Component;
const MockComponent = {} as unknown as import("svelte").Component;

function makeEntry(id = "ext:foo") {
  return { id, label: "Foo", icon: MockIcon, component: MockComponent };
}

describe("registerDashboardWorkspaceType", () => {
  beforeEach(() => clearDashboardRegistry());

  it("adds entry to registry store", () => {
    registerDashboardWorkspaceType(makeEntry("ext:foo"));
    expect(get(dashboardWorkspaceRegistry).get("ext:foo")).toBeDefined();
  });

  it("overwrites duplicate id", () => {
    registerDashboardWorkspaceType(makeEntry("ext:foo"));
    registerDashboardWorkspaceType({ ...makeEntry("ext:foo"), label: "Bar" });
    expect(get(dashboardWorkspaceRegistry).get("ext:foo")!.label).toBe("Bar");
  });
});

describe("unregisterDashboardWorkspaceType", () => {
  beforeEach(() => clearDashboardRegistry());

  it("removes entry from registry", () => {
    registerDashboardWorkspaceType(makeEntry("ext:foo"));
    unregisterDashboardWorkspaceType("ext:foo");
    expect(get(dashboardWorkspaceRegistry).get("ext:foo")).toBeUndefined();
  });
});

describe("getDashboardEntry", () => {
  beforeEach(() => clearDashboardRegistry());

  it("returns undefined for unknown id", () => {
    expect(getDashboardEntry("ext:unknown")).toBeUndefined();
  });

  it("returns entry after registration", () => {
    registerDashboardWorkspaceType(makeEntry("ext:foo"));
    expect(getDashboardEntry("ext:foo")?.label).toBe("Foo");
  });
});

describe("spawnOrNavigate", () => {
  beforeEach(() => {
    clearDashboardRegistry();
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
    registerDashboardWorkspaceType(makeEntry("ext:foo"));
    await spawnOrNavigate("ext:foo");
    expect(createWorkspaceFromDef).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Foo",
        metadata: expect.objectContaining({
          dashboardWorkspaceId: "ext:foo",
          isDashboard: true,
        }),
      }),
    );
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it("switches to existing workspace instead of creating", async () => {
    vi.mocked(workspaces).subscribe = vi.fn((cb) => {
      cb([
        {
          id: "ws-1",
          metadata: { dashboardWorkspaceId: "ext:foo", isDashboard: true },
        },
      ]);
      return () => {};
    });
    registerDashboardWorkspaceType(makeEntry("ext:foo"));
    await spawnOrNavigate("ext:foo");
    expect(switchWorkspace).toHaveBeenCalledWith(0);
    expect(createWorkspaceFromDef).not.toHaveBeenCalled();
  });
});
