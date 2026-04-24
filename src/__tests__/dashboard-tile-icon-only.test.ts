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

  it("pins the Settings tile to the end of the dashboard grid", () => {
    const group = makeDashboardWs("ws-group", "Overview", "group");
    const settings = makeDashboardWs("ws-settings", "Settings", "settings");
    const diff = makeDashboardWs("ws-diff", "Diff", "diff");
    const agentic = makeDashboardWs("ws-agentic", "Agents", "agentic");

    // Order in the store: settings first, group second, then diff, then
    // agentic — so the sort has work to do: settings must move last.
    workspaces.set([settings, group, diff, agentic]);

    const { container } = render(WorkspaceListView, {
      props: {
        filterIds: new Set([settings.id, group.id, diff.id, agentic.id]),
        accentColor: "#ff00aa",
        scopeId: "g1",
      },
    });

    const tiles = Array.from(
      container.querySelectorAll<HTMLElement>("[data-dashboard-item]"),
    );
    const contribs = tiles.map((t) =>
      t.getAttribute("data-dashboard-contribution"),
    );
    expect(contribs[contribs.length - 1]).toBe("settings");
    // Other contributions keep their relative order.
    expect(contribs.slice(0, -1)).toEqual(["group", "diff", "agentic"]);
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
