/**
 * Story 5: Settings dashboard exposes a per-group toggle row for every
 * registered contribution (except "settings" itself). autoProvision
 * rows render locked (disabled + lockedReason); user-opt-in rows
 * toggle the dashboard workspace on and off.
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

import GroupDashboardSettings from "../lib/components/GroupDashboardSettings.svelte";
import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import { workspacesStore } from "../lib/stores/workspace-groups";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";

const GROUP = {
  id: "g1",
  name: "My Group",
  path: "/tmp/g1",
  color: "purple",
  workspaceIds: [],
  isGit: false,
  createdAt: "2026-04-21T00:00:00.000Z",
};

describe("GroupDashboardSettings — Dashboards toggles", () => {
  beforeEach(() => {
    cleanup();
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
    workspacesStore.set([GROUP]);
    resetDashboardContributions();
  });

  it("renders a row for every contribution except 'settings'", () => {
    registerDashboardContribution({
      id: "group",
      source: "core",
      label: "Group Dashboard",
      actionLabel: "Add Group",
      capPerGroup: 1,
      autoProvision: true,
      lockedReason: "Required (Overview)",
      create: vi.fn(async () => "ws-grp"),
    });
    registerDashboardContribution({
      id: "settings",
      source: "core",
      label: "Settings",
      actionLabel: "Add Settings",
      capPerGroup: 1,
      autoProvision: true,
      create: vi.fn(async () => "ws-st"),
    });
    registerDashboardContribution({
      id: "diff",
      source: "diff-viewer",
      label: "Diff",
      actionLabel: "Add Diff",
      capPerGroup: 1,
      create: vi.fn(async () => "ws-diff"),
    });

    const { container } = render(GroupDashboardSettings, {
      props: { groupId: GROUP.id },
    });

    const rows = container.querySelectorAll("[data-dashboard-toggle-row]");
    const ids = Array.from(rows).map((r) =>
      r.getAttribute("data-dashboard-toggle-row"),
    );
    expect(ids).toEqual(["group", "diff"]);
  });

  it("renders autoProvision rows as locked (disabled + reason)", () => {
    registerDashboardContribution({
      id: "group",
      source: "core",
      label: "Group Dashboard",
      actionLabel: "Add Group",
      capPerGroup: 1,
      autoProvision: true,
      lockedReason: "Required (Overview)",
      create: vi.fn(async () => "ws-grp"),
    });

    const { container } = render(GroupDashboardSettings, {
      props: { groupId: GROUP.id },
    });

    const row = container.querySelector('[data-dashboard-toggle-row="group"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-locked")).toBe("true");
    const input = row!.querySelector<HTMLInputElement>(
      "[data-dashboard-toggle-input]",
    );
    expect(input?.disabled).toBe(true);
    expect(input?.checked).toBe(true);
    const lockedBadge = row!.querySelector("[data-dashboard-toggle-locked]");
    expect(lockedBadge?.textContent?.trim()).toBe("Required (Overview)");
  });

  it("reflects active state for user-opt-in contributions", () => {
    registerDashboardContribution({
      id: "diff",
      source: "diff-viewer",
      label: "Diff",
      actionLabel: "Add Diff",
      capPerGroup: 1,
      create: vi.fn(async () => "ws-diff"),
    });
    // Seed an active diff workspace for this group.
    nestedWorkspaces.set([
      {
        id: "ws-diff-1",
        name: "Diff",
        layout: { pane: { id: "p", surfaces: [], activeIdx: 0 } },
        metadata: {
          isDashboard: true,
          groupId: GROUP.id,
          dashboardContributionId: "diff",
        },
      } as never,
    ]);

    const { container } = render(GroupDashboardSettings, {
      props: { groupId: GROUP.id },
    });

    const row = container.querySelector('[data-dashboard-toggle-row="diff"]');
    expect(row?.getAttribute("data-active")).toBe("true");
    const input = row!.querySelector<HTMLInputElement>(
      "[data-dashboard-toggle-input]",
    );
    expect(input?.checked).toBe(true);
  });
});
