/**
 * WorkspacesWidget component tests — verifies that the widget renders
 * correctly given different dashboard host contexts and workspace stores.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";

const { switchNestedWorkspaceMock } = vi.hoisted(() => ({
  switchNestedWorkspaceMock: vi.fn(),
}));
vi.mock("../lib/services/workspace-service", () => ({
  switchNestedWorkspace: switchNestedWorkspaceMock,
  createNestedWorkspace: vi.fn(),
  schedulePersist: vi.fn(),
  closeNestedWorkspace: vi.fn(),
  renameNestedWorkspace: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import WorkspacesWidget from "../lib/components/WorkspacesWidget.svelte";
import { nestedWorkspaces } from "../lib/stores/workspace";
import {
  setWorkspaces,
  resetWorkspacesForTest,
} from "../lib/stores/workspace-groups";
import { DASHBOARD_HOST_KEY } from "../lib/contexts/dashboard-host";
import type { NestedWorkspace } from "../lib/types";

function makeWorkspace(
  id: string,
  name: string,
  metadata: Record<string, unknown> = {},
): NestedWorkspace {
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
  nestedWorkspaces.set([]);
  resetWorkspacesForTest();
});

describe("WorkspacesWidget", () => {
  it("renders nothing when there is no dashboard host context", () => {
    const { container } = render(WorkspacesWidget);
    expect(
      container.querySelector("[data-nestedWorkspaces-widget]"),
    ).toBeNull();
  });

  it("renders nothing when the group only has a group-overview dashboard", () => {
    setWorkspaces([
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
    nestedWorkspaces.set([
      makeWorkspace("ws-overview", "Group Overview", {
        parentWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "group",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { parentWorkspaceId: "g1" } }],
      ]),
    });

    expect(container.querySelector("[data-dashboard-cards]")).toBeNull();
    expect(container.querySelector("[data-workspace-rows]")).toBeNull();
  });

  it("renders non-group dashboard cards but excludes the group overview", () => {
    setWorkspaces([
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
    nestedWorkspaces.set([
      makeWorkspace("ws-overview", "Group Overview", {
        parentWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "group",
      }),
      makeWorkspace("ws-settings", "Settings Dashboard", {
        parentWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "settings",
      }),
      makeWorkspace("ws-agentic", "Agentic Dashboard", {
        parentWorkspaceId: "g1",
        isDashboard: true,
        dashboardContributionId: "agentic",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { parentWorkspaceId: "g1" } }],
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
        name: "My Group",
        path: "/tmp/g1",
        color: "green",
        workspaceIds: [],
        isGit: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    nestedWorkspaces.set([
      makeWorkspace("ws-alpha", "Alpha NestedWorkspace", {
        parentWorkspaceId: "g1",
      }),
      makeWorkspace("ws-beta", "Beta NestedWorkspace", {
        parentWorkspaceId: "g1",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { parentWorkspaceId: "g1" } }],
      ]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);

    const names = Array.from(rows).map((r) => r.getAttribute("data-ws-name"));
    expect(names).toContain("Alpha NestedWorkspace");
    expect(names).toContain("Beta NestedWorkspace");
  });

  it("excludes nestedWorkspaces from other groups", () => {
    setWorkspaces([
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
    nestedWorkspaces.set([
      makeWorkspace("ws-g1", "G1 NestedWorkspace", { parentWorkspaceId: "g1" }),
      makeWorkspace("ws-g2", "G2 NestedWorkspace", { parentWorkspaceId: "g2" }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { parentWorkspaceId: "g1" } }],
      ]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-ws-name")).toBe("G1 NestedWorkspace");
  });
});

describe("WorkspacesWidget click-to-navigate", () => {
  beforeEach(() => {
    cleanup();
    switchNestedWorkspaceMock.mockClear();
    nestedWorkspaces.set([]);
    resetWorkspacesForTest();
  });

  it("clicking a workspace row calls switchNestedWorkspace with its index", async () => {
    setWorkspaces([
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
    nestedWorkspaces.set([
      makeWorkspace("ws-alpha", "Alpha NestedWorkspace", {
        parentWorkspaceId: "g1",
      }),
      makeWorkspace("ws-beta", "Beta NestedWorkspace", {
        parentWorkspaceId: "g1",
      }),
    ]);

    const { container } = render(WorkspacesWidget, {
      context: new Map([
        [DASHBOARD_HOST_KEY, { metadata: { parentWorkspaceId: "g1" } }],
      ]),
    });

    const rows = container.querySelectorAll("[data-workspace-row]");
    expect(rows).toHaveLength(2);

    // Click the second workspace row (index 1 in the nestedWorkspaces store)
    await fireEvent.click(rows[1]!);

    expect(switchNestedWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(switchNestedWorkspaceMock).toHaveBeenCalledWith(1);
  });
});
