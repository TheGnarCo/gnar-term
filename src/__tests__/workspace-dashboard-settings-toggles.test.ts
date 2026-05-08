/**
 * WorkspaceDashboardSettings — per-workspace dashboard toggle rows.
 *
 * Toggles control persisted Settings state ("enabled" — drives chip
 * presence). They do NOT open or close dashboard tabs. Closing a tab
 * does not flip the toggle. Settings ↔ chips ↔ tabs are decoupled.
 *
 *   - autoProvision rows: locked-on (disabled checkbox + lockedReason).
 *   - defaultEnabled rows: checked unless `dismissedDashboardContributionIds`
 *     lists them; toggling off appends, toggling on removes.
 *   - opt-in rows: checked iff `enabledDashboardContributionIds` lists them;
 *     toggling on appends, toggling off removes.
 *
 *   - The "settings" contribution is excluded from the row list — the user
 *     is already inside its panel and cannot disable it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { tick } from "svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import WorkspaceDashboardSettings from "../lib/components/WorkspaceDashboardSettings.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";

const WORKSPACE = {
  id: "g1",
  name: "My Workspace",
  path: "/tmp/g1",
  color: "purple",
  branchedWorkspaceIds: [],
  isGit: false,
  createdAt: "2026-04-21T00:00:00.000Z",
  paneLayout: {
    type: "pane",
    pane: { id: "wp", surfaces: [], activeSurfaceId: null },
  },
  activePaneId: "wp",
} as never;

function getWorkspaceFromStore(id: string):
  | {
      dismissedDashboardContributionIds?: string[];
      enabledDashboardContributionIds?: string[];
    }
  | undefined {
  let v:
    | {
        dismissedDashboardContributionIds?: string[];
        enabledDashboardContributionIds?: string[];
      }
    | undefined;
  const unsub = workspaces.subscribe((list) => {
    v = list.find((w) => w.id === id) as typeof v;
  });
  unsub();
  return v;
}

describe("WorkspaceDashboardSettings — Dashboards toggles", () => {
  beforeEach(() => {
    cleanup();
    workspaces.set([WORKSPACE]);
    activeWorkspaceIdx.set(-1);
    resetDashboardContributions();
  });

  it("renders a row for every contribution except 'settings'", () => {
    registerDashboardContribution({
      id: "group",
      source: "core",
      label: "Workspace Dashboard",
      actionLabel: "Add Workspace Dashboard",
      capPerWorkspace: 1,
      autoProvision: true,
      lockedReason: "Required (Overview)",
      openAsTab: vi.fn(async () => {}),
    });
    registerDashboardContribution({
      id: "settings",
      source: "core",
      label: "Settings",
      actionLabel: "Add Settings",
      capPerWorkspace: 1,
      autoProvision: true,
      openAsTab: vi.fn(async () => {}),
    });
    registerDashboardContribution({
      id: "diff",
      source: "diff-viewer",
      label: "Diff",
      actionLabel: "Add Diff",
      capPerWorkspace: 1,
      openAsTab: vi.fn(async () => {}),
    });

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
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
      label: "Workspace Dashboard",
      actionLabel: "Add Workspace Dashboard",
      capPerWorkspace: 1,
      autoProvision: true,
      lockedReason: "Required (Overview)",
      openAsTab: vi.fn(async () => {}),
    });

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
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

  it("toggling a defaultEnabled dashboard OFF records dismissal but does NOT close tabs", async () => {
    const openAsTab = vi.fn(async () => {});
    registerDashboardContribution({
      id: "diff",
      source: "diff-viewer",
      label: "Diff",
      actionLabel: "Add Diff",
      capPerWorkspace: 1,
      defaultEnabled: true,
      openAsTab,
    });

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-dashboard-toggle-row="diff"] [data-dashboard-toggle-input]',
    );
    expect(input?.checked).toBe(true);
    await fireEvent.click(input!);
    await tick();

    const ws = getWorkspaceFromStore(WORKSPACE.id);
    expect(ws?.dismissedDashboardContributionIds).toEqual(["diff"]);
    // Toggle is decoupled from tab lifecycle — Settings does not invoke
    // openAsTab on enable nor close on disable.
    expect(openAsTab).not.toHaveBeenCalled();
  });

  it("toggling a defaultEnabled dashboard ON clears any prior dismissal", async () => {
    const openAsTab = vi.fn(async () => {});
    registerDashboardContribution({
      id: "diff",
      source: "diff-viewer",
      label: "Diff",
      actionLabel: "Add Diff",
      capPerWorkspace: 1,
      defaultEnabled: true,
      openAsTab,
    });
    workspaces.set([
      { ...WORKSPACE, dismissedDashboardContributionIds: ["diff"] } as never,
    ]);

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-dashboard-toggle-row="diff"] [data-dashboard-toggle-input]',
    );
    expect(input?.checked).toBe(false);
    await fireEvent.click(input!);
    await tick();

    const ws = getWorkspaceFromStore(WORKSPACE.id);
    expect(ws?.dismissedDashboardContributionIds).toBeUndefined();
    expect(openAsTab).not.toHaveBeenCalled();
  });

  it("toggling an opt-in dashboard ON records it in enabledDashboardContributionIds", async () => {
    const openAsTab = vi.fn(async () => {});
    registerDashboardContribution({
      id: "claude-settings",
      source: "claude-settings",
      label: "Claude Settings",
      actionLabel: "Add Claude Settings",
      capPerWorkspace: 1,
      openAsTab,
    });

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-dashboard-toggle-row="claude-settings"] [data-dashboard-toggle-input]',
    );
    expect(input?.checked).toBe(false);
    await fireEvent.click(input!);
    await tick();

    const ws = getWorkspaceFromStore(WORKSPACE.id);
    expect(ws?.enabledDashboardContributionIds).toEqual(["claude-settings"]);
    // Toggling does NOT spawn a tab — that's the chip's job.
    expect(openAsTab).not.toHaveBeenCalled();
  });

  it("toggling an opt-in dashboard OFF removes it from enabledDashboardContributionIds", async () => {
    registerDashboardContribution({
      id: "claude-settings",
      source: "claude-settings",
      label: "Claude Settings",
      actionLabel: "Add Claude Settings",
      capPerWorkspace: 1,
      openAsTab: vi.fn(async () => {}),
    });
    workspaces.set([
      {
        ...WORKSPACE,
        enabledDashboardContributionIds: ["claude-settings"],
      } as never,
    ]);

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-dashboard-toggle-row="claude-settings"] [data-dashboard-toggle-input]',
    );
    expect(input?.checked).toBe(true);
    await fireEvent.click(input!);
    await tick();

    const ws = getWorkspaceFromStore(WORKSPACE.id);
    expect(ws?.enabledDashboardContributionIds).toBeUndefined();
  });

  it("reflects enabled state for defaultEnabled contributions (default-on)", () => {
    registerDashboardContribution({
      id: "diff",
      source: "diff-viewer",
      label: "Diff",
      actionLabel: "Add Diff",
      capPerWorkspace: 1,
      defaultEnabled: true,
      openAsTab: vi.fn(async () => {}),
    });

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
    });

    const row = container.querySelector('[data-dashboard-toggle-row="diff"]');
    expect(row?.getAttribute("data-active")).toBe("true");
    const input = row!.querySelector<HTMLInputElement>(
      "[data-dashboard-toggle-input]",
    );
    expect(input?.checked).toBe(true);
  });

  it("opt-in contributions are off by default (no enabled record)", () => {
    registerDashboardContribution({
      id: "claude-settings",
      source: "claude-settings",
      label: "Claude Settings",
      actionLabel: "Add Claude Settings",
      capPerWorkspace: 1,
      openAsTab: vi.fn(async () => {}),
    });

    const { container } = render(WorkspaceDashboardSettings, {
      props: { rootWorkspaceId: WORKSPACE.id },
    });

    const row = container.querySelector(
      '[data-dashboard-toggle-row="claude-settings"]',
    );
    expect(row?.getAttribute("data-active")).toBeNull();
    const input = row!.querySelector<HTMLInputElement>(
      "[data-dashboard-toggle-input]",
    );
    expect(input?.checked).toBe(false);
  });
});
