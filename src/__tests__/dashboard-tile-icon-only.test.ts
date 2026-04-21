/**
 * Dashboard tiles render icon-only: no text label, workspace name lives
 * in the `title` attribute for hover-discoverability. Regression for the
 * redesign that strips .dashboard-tile-label from WorkspaceListView.
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

import WorkspaceListView from "../lib/components/WorkspaceListView.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import type { Workspace } from "../lib/types";

function makeDashboardWs(
  id: string,
  name: string,
  contribId: string,
): Workspace {
  return {
    id,
    name,
    layout: { pane: { id: `${id}-pane`, surfaces: [], activeIdx: 0 } },
    metadata: {
      isDashboard: true,
      groupId: "g1",
      dashboardContributionId: contribId,
    },
  } as Workspace;
}

describe("dashboard tile — icon only", () => {
  beforeEach(() => {
    cleanup();
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("renders no visible label text on the tile", () => {
    const ws = makeDashboardWs("ws-1", "Group Dashboard", "group");
    workspaces.set([ws]);

    const { container } = render(WorkspaceListView, {
      props: {
        filterIds: new Set([ws.id]),
        accentColor: "#ff00aa",
        scopeId: "g1",
      },
    });

    const tile = container.querySelector<HTMLElement>(
      `[data-dashboard-item="${ws.id}"]`,
    );
    expect(tile).not.toBeNull();

    // The visible label span is removed — only the SVG icon (with its
    // accessible <title>) remains inside the tile. Assert by DOM shape:
    // no non-SVG text nodes, and no `.dashboard-tile-label` element.
    expect(tile?.querySelector(".dashboard-tile-label")).toBeNull();
  });

  it("preserves the workspace name in the tile's title attribute", () => {
    const ws = makeDashboardWs("ws-2", "My Group Dashboard", "group");
    workspaces.set([ws]);

    const { container } = render(WorkspaceListView, {
      props: {
        filterIds: new Set([ws.id]),
        accentColor: "#ff00aa",
        scopeId: "g1",
      },
    });

    const tile = container.querySelector<HTMLElement>(
      `[data-dashboard-item="${ws.id}"]`,
    );
    expect(tile?.getAttribute("title")).toBe("My Group Dashboard");
  });
});
