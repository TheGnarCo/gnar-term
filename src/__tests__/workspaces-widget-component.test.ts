/**
 * WorkspacesWidget component tests — verifies that the widget renders
 * correctly given different dashboard host contexts and workspace stores.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import WorkspacesWidget from "../lib/components/WorkspacesWidget.svelte";
import { workspaces } from "../lib/stores/workspace";
import {
  setWorkspaceGroups,
  resetWorkspaceGroupsForTest,
} from "../lib/stores/workspace-groups";
import { DASHBOARD_HOST_KEY } from "../lib/contexts/dashboard-host";
import type { Workspace } from "../lib/types";

function makeWorkspace(
  id: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Workspace {
  return {
    id,
    name,
    splitRoot: {
      type: "pane",
      pane: { id: `${id}-pane`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: null,
    metadata,
  };
}

beforeEach(() => {
  cleanup();
  workspaces.set([]);
  resetWorkspaceGroupsForTest();
});

describe("WorkspacesWidget", () => {
  it("renders nothing when there is no dashboard host context", () => {
    const { container } = render(WorkspacesWidget);
    expect(container.querySelector("[data-workspaces-widget]")).toBeNull();
  });

  it("renders nothing when the group only has a group-overview dashboard", () => {
    setWorkspaceGroups([
      {
        id: "g1",
        name: "My Group",
        path: "/tmp/g1",
        color: "purple",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeWorkspace("ws-overview", "Group Overview", {
        groupId: "g1",
        isDashboard: true,
        dashboardContributionId: "group",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([[DASHBOARD_HOST_KEY, { metadata: { groupId: "g1" } }]]),
    });

    expect(container.querySelector("[data-dashboard-cards]")).toBeNull();
    expect(container.querySelector("[data-workspace-rows]")).toBeNull();
  });

  it("renders non-group dashboard cards but excludes the group overview", () => {
    setWorkspaceGroups([
      {
        id: "g1",
        name: "My Group",
        path: "/tmp/g1",
        color: "blue",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeWorkspace("ws-overview", "Group Overview", {
        groupId: "g1",
        isDashboard: true,
        dashboardContributionId: "group",
      }),
      makeWorkspace("ws-settings", "Settings Dashboard", {
        groupId: "g1",
        isDashboard: true,
        dashboardContributionId: "settings",
      }),
      makeWorkspace("ws-agentic", "Agentic Dashboard", {
        groupId: "g1",
        isDashboard: true,
        dashboardContributionId: "agentic",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([[DASHBOARD_HOST_KEY, { metadata: { groupId: "g1" } }]]),
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
    setWorkspaceGroups([
      {
        id: "g1",
        name: "My Group",
        path: "/tmp/g1",
        color: "green",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeWorkspace("ws-alpha", "Alpha Workspace", { groupId: "g1" }),
      makeWorkspace("ws-beta", "Beta Workspace", { groupId: "g1" }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([[DASHBOARD_HOST_KEY, { metadata: { groupId: "g1" } }]]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);

    const names = Array.from(rows).map((r) => r.getAttribute("data-ws-name"));
    expect(names).toContain("Alpha Workspace");
    expect(names).toContain("Beta Workspace");
  });

  it("excludes workspaces from other groups", () => {
    setWorkspaceGroups([
      {
        id: "g1",
        name: "Group One",
        path: "/tmp/g1",
        color: "red",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "g2",
        name: "Group Two",
        path: "/tmp/g2",
        color: "blue",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    workspaces.set([
      makeWorkspace("ws-g1", "G1 Workspace", { groupId: "g1" }),
      makeWorkspace("ws-g2", "G2 Workspace", { groupId: "g2" }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([[DASHBOARD_HOST_KEY, { metadata: { groupId: "g1" } }]]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-ws-name")).toBe("G1 Workspace");
  });
});
