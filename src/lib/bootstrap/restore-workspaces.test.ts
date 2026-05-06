/**
 * Regression test for "blank sidebar after reload" bug:
 *
 * `restoreWorkspaces` clears the workspaces store with `workspaces.set([])`
 * after seeding it from disk, then reads `getWorkspaces()` to compute the
 * set of "known" workspace ids it uses to filter persisted dashboards.
 * Because the store has just been cleared, that set is always empty and
 * EVERY persisted dashboard whose `rootWorkspaceId` points at a workspace
 * gets stripped — even when the owning workspace is in `runtimeDefs` and
 * about to be re-created. The result: dashboards never make it back into
 * the store on restart, and downstream sidebar tiles disappear.
 *
 * Fix: compute `knownWorkspaceIds` from `runtimeDefs` (the persisted
 * source of truth that drives re-creation), not from the cleared store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../terminal-service", () => ({
  createTerminalSurface: vi.fn(async (pane: { surfaces: unknown[] }) => {
    const stub = {
      kind: "terminal" as const,
      id: `t-${Math.random().toString(36).slice(2)}`,
      title: "stub",
      ptyId: -1,
      hasUnread: false,
      opened: false,
    };
    pane.surfaces.push(stub);
    return stub;
  }),
}));

import { restoreWorkspaces, resetRestoreSignal } from "./restore-workspaces";
import {
  workspaces,
  activeWorkspaceIdx,
  resetWorkspacesForTest,
} from "../stores/workspace";
import * as config from "../config";
import type { AppState, WorkspaceDef } from "../config";

const ROOT: WorkspaceDef = {
  id: "root-1",
  name: "Root",
  path: "/repos/root",
  color: "blue",
  isGit: true,
  createdAt: "2026-01-01",
  layout: { pane: { surfaces: [] } },
};

const OWNED_DASHBOARD: WorkspaceDef = {
  id: "dash-1",
  name: "Dashboard",
  rootWorkspaceId: "root-1",
  isDashboard: true,
  dashboardContributionId: "group",
  layout: { pane: { surfaces: [] } },
};

describe("restoreWorkspaces — owned dashboards survive restart", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetWorkspacesForTest();
    resetRestoreSignal();
  });

  it("re-creates a persisted dashboard whose owning workspace is also persisted", async () => {
    const state: AppState = {
      workspaces: [ROOT, OWNED_DASHBOARD],
      activeWorkspaceId: "root-1",
    };
    const loadStateSpy = vi.spyOn(config, "loadState").mockResolvedValue(state);

    await restoreWorkspaces(
      {
        path: null,
        working_directory: null,
        command: null,
        title: null,
        workspace: null,
        config: null,
      },
      {},
    );

    const restored = get(workspaces);
    const ids = restored.map((w) => w.id).sort();
    expect(ids).toEqual(["dash-1", "root-1"]);

    const dash = restored.find((w) => w.id === "dash-1");
    expect(dash?.isDashboard).toBe(true);
    expect(dash?.rootWorkspaceId).toBe("root-1");
    expect(dash?.dashboardContributionId).toBe("group");

    // Regression: root-shaped Workspaces must own a (possibly empty)
    // `branchedWorkspaceIds` array. WorkspaceRecord's contract requires
    // it; consumers like WorkspaceSectionContent crash if it's undefined.
    const root = restored.find((w) => w.id === "root-1");
    expect(Array.isArray(root?.branchedWorkspaceIds)).toBe(true);

    loadStateSpy.mockRestore();
  });
});
