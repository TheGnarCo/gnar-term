/**
 * Regression: when creating a new workspace, the user should land on the
 * workspace itself (its tabs surface) — NOT on the auto-provisioned
 * Settings dashboard. createWorkspaceFromDef auto-switches activeWorkspaceIdx
 * to whichever workspace it just created, so each Settings auto-provision
 * inside provisionAutoDashboardsForWorkspace would otherwise leave the
 * user staring at Settings. createWorkspaceFlow restores the active idx
 * to the new workspace at the end.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(false),
  convertFileSrc: (p: string) => p,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  registerDashboardContribution,
  resetDashboardContributions,
} from "../lib/services/dashboard-contribution-registry";
import { pendingCreateResolver } from "../lib/stores/workspaces-ui";
import { createWorkspaceFlow } from "../lib/bootstrap/init-workspaces";

describe("createWorkspaceFlow — final active workspace", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetDashboardContributions();
    pendingCreateResolver.set(null);
  });

  it("leaves activeWorkspaceIdx pointing at the new workspace, not the auto-provisioned Settings dashboard", async () => {
    // Settings contribution: autoProvision. Its create() simulates
    // createWorkspaceFromDef appending a dashboard and yanking
    // activeWorkspaceIdx to it (the real auto-switch behavior).
    registerDashboardContribution({
      id: "settings",
      source: "core",
      label: "Settings",
      actionLabel: "Add Settings",
      capPerWorkspace: 1,
      autoProvision: true,
      create: vi.fn(async (workspace) => {
        workspaces.update((cur) => {
          const next = [
            ...cur,
            {
              id: "ws-settings-auto",
              name: "Settings",
              paneLayout: {
                type: "pane",
                pane: { id: "sp", surfaces: [], activeSurfaceId: null },
              },
              activePaneId: "sp",
              isDashboard: true,
              rootWorkspaceId: workspace.id,
              dashboardContributionId: "settings",
            } as never,
          ];
          activeWorkspaceIdx.set(next.length - 1);
          return next;
        });
        return "ws-settings-auto";
      }),
    });

    // Auto-resolve the create dialog so createWorkspaceFlow proceeds.
    const unsub = pendingCreateResolver.subscribe((resolver) => {
      if (resolver) {
        resolver({
          name: "My Workspace",
          path: "/tmp/my-workspace",
          color: "purple",
        });
      }
    });

    const id = await createWorkspaceFlow();
    unsub();

    expect(id).not.toBeNull();
    const list = get(workspaces);
    const finalIdx = get(activeWorkspaceIdx);
    expect(finalIdx).toBeGreaterThanOrEqual(0);
    expect(list[finalIdx]?.id).toBe(id);
    expect(list[finalIdx]?.isDashboard).not.toBe(true);
  });
});
