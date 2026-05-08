/**
 * `restoreWorkspaces` — startup hydration of persisted state.
 *
 * Dashboards live as tabs inside the root workspace's pane tree, so any
 * persisted `isDashboard: true` workspace entry from older app versions
 * is silently dropped on restore (auto-provisioning re-establishes each
 * dashboard contribution as a tab via `openAsTab` instead). Root
 * workspaces are re-created normally; the dashboard records do not
 * become independent workspaces.
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

const LEGACY_DASHBOARD: WorkspaceDef = {
  id: "dash-1",
  name: "Dashboard",
  rootWorkspaceId: "root-1",
  isDashboard: true,
  dashboardContributionId: "group",
  layout: { pane: { surfaces: [] } },
};

describe("restoreWorkspaces — legacy dashboard records dropped on restore", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    resetWorkspacesForTest();
    resetRestoreSignal();
  });

  it("drops persisted isDashboard entries; only the root workspace survives", async () => {
    const state: AppState = {
      workspaces: [ROOT, LEGACY_DASHBOARD],
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
    const ids = restored.map((w) => w.id);
    expect(ids).toEqual(["root-1"]);

    // No restored workspace carries the dashboard discriminants — the
    // legacy entry was silently dropped, not retagged.
    const dash = restored.find((w) => w.id === "dash-1");
    expect(dash).toBeUndefined();
    expect(restored.some((w) => w.isDashboard)).toBe(false);

    // Root retains its `branchedWorkspaceIds` invariant (RootWorkspace
    // contract — consumers like WorkspaceSectionContent require it).
    const root = restored.find((w) => w.id === "root-1");
    expect(Array.isArray(root?.branchedWorkspaceIds)).toBe(true);

    loadStateSpy.mockRestore();
  });
});
