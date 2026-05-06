/**
 * WorkspacesWidget component tests — verifies that the widget renders
 * correctly given different dashboard host contexts and workspace stores.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";

const { switchWorkspaceMock } = vi.hoisted(() => ({
  switchWorkspaceMock: vi.fn(),
}));
vi.mock("../lib/services/workspace-runtime-service", () => ({
  switchWorkspace: switchWorkspaceMock,
  createWorkspace: vi.fn(),
  schedulePersist: vi.fn(),
  closeWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import WorkspacesWidget from "../lib/components/WorkspacesWidget.svelte";
import { workspaces } from "../lib/stores/workspace";
import { setWorkspaces, resetWorkspacesForTest } from "../lib/stores/workspace";
import { DASHBOARD_HOST_KEY } from "../lib/contexts/dashboard-host";
import type { Workspace } from "../lib/types";

function makeChildWorkspace(
  id: string,
  name: string,
  extraFields: Record<string, unknown> = {},
): Workspace {
  return {
    id,
    name,
    splitRoot: {
      type: "pane",
      pane: { id: `${id}-pane`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: null,
    ...extraFields,
  } as Workspace;
}

beforeEach(() => {
  cleanup();
  workspaces.set([]);
  resetWorkspacesForTest();
});

describe("WorkspacesWidget", () => {
  it("renders nothing when there is no dashboard host context", () => {
    const { container } = render(WorkspacesWidget);
    expect(container.querySelector("[data-workspaces-widget]")).toBeNull();
  });

  it("renders nothing when the workspace only has a workspace-overview dashboard", () => {
    setWorkspaces([
      {
        id: "g1",
        name: "My Workspace",
        path: "/tmp/g1",
        color: "purple",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeChildWorkspace("ws-overview", "Workspace Overview", {
        rootWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "group",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { rootWorkspaceId: "g1" } }],
      ]),
    });

    expect(container.querySelector("[data-dashboard-cards]")).toBeNull();
    expect(container.querySelector("[data-workspace-rows]")).toBeNull();
  });

  it("renders non-overview dashboard cards but excludes the workspace overview", () => {
    setWorkspaces([
      {
        id: "g1",
        name: "My Workspace",
        path: "/tmp/g1",
        color: "blue",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeChildWorkspace("ws-overview", "Workspace Overview", {
        rootWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "group",
      }),
      makeChildWorkspace("ws-settings", "Settings Dashboard", {
        rootWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "settings",
      }),
      makeChildWorkspace("ws-agentic", "Agentic Dashboard", {
        rootWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "agentic",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { rootWorkspaceId: "g1" } }],
      ]),
    });

    const cards = container.querySelectorAll("[data-dashboard-card]");
    expect(cards).toHaveLength(2);

    const cardIds = Array.from(cards).map((c) =>
      c.getAttribute("data-workspace-id"),
    );
    expect(cardIds).toContain("ws-settings");
    expect(cardIds).toContain("ws-agentic");
    expect(cardIds).not.toContain("ws-overview");
  });

  it("renders regular workspace rows with correct names", () => {
    setWorkspaces([
      {
        id: "g1",
        name: "My Workspace",
        path: "/tmp/g1",
        color: "green",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeChildWorkspace("ws-alpha", "Alpha Workspace", {
        rootWorkspaceId: "g1",
      }),
      makeChildWorkspace("ws-beta", "Beta Workspace", {
        rootWorkspaceId: "g1",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { rootWorkspaceId: "g1" } }],
      ]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);

    const names = Array.from(rows).map((r) => r.getAttribute("data-ws-name"));
    expect(names).toContain("Alpha Workspace");
    expect(names).toContain("Beta Workspace");
  });

  it("excludes workspaces from other workspaces", () => {
    setWorkspaces([
      {
        id: "g1",
        name: "Workspace One",
        path: "/tmp/g1",
        color: "red",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "g2",
        name: "Workspace Two",
        path: "/tmp/g2",
        color: "blue",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeChildWorkspace("ws-g1", "G1 Workspace", {
        rootWorkspaceId: "g1",
      }),
      makeChildWorkspace("ws-g2", "G2 Workspace", {
        rootWorkspaceId: "g2",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { rootWorkspaceId: "g1" } }],
      ]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-ws-name")).toBe("G1 Workspace");
  });
});

describe("WorkspacesWidget click-to-navigate", () => {
  beforeEach(() => {
    cleanup();
    switchWorkspaceMock.mockClear();
    workspaces.set([]);
    resetWorkspacesForTest();
  });

  it("clicking a workspace row calls switchWorkspace with its index", async () => {
    setWorkspaces([
      {
        id: "g1",
        name: "My Workspace",
        path: "/tmp/g1",
        color: "blue",
        branchedWorkspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeChildWorkspace("ws-alpha", "Alpha Workspace", {
        rootWorkspaceId: "g1",
      }),
      makeChildWorkspace("ws-beta", "Beta Workspace", {
        rootWorkspaceId: "g1",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { rootWorkspaceId: "g1" } }],
      ]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);

    // Click the second workspace row (index 1 in the workspaces store)
    await fireEvent.click(rows[1]!);

    expect(switchWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(switchWorkspaceMock).toHaveBeenCalledWith(1);
  });
});
