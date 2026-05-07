/**
 * Regression: createWorkspaceFromDef must not append a duplicate runtime
 * Workspace when called twice with the same id for a Branch or Dashboard.
 *
 * The merge branch in createWorkspaceFromDef uses `getWorkspace(ws.id)` to
 * detect "this is the Workspace's own root" and merge fields onto the
 * existing record. `getWorkspace` filters to root-shaped entries, so a
 * Branch (rootWorkspaceId set) or a Dashboard (isDashboard true) is never
 * matched there — and would otherwise fall through to the append branch,
 * landing as a duplicate in `workspaces`. App.svelte renders WorkspaceView
 * inside a keyed each on `ws.id`, so a duplicate id surfaces as a Svelte
 * `each_key_duplicate` runtime error. The append branch must dedupe by id.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { createWorkspaceFromDef } from "../lib/services/workspace-runtime-service";
import { resetWorkspacesForTest } from "../lib/stores/workspace";
import { rootRowOrder } from "../lib/stores/root-row-order";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi
    .fn()
    .mockImplementation(
      async (pane: { surfaces: unknown[]; activeSurfaceId: string | null }) => {
        const surface = {
          kind: "terminal" as const,
          id: `surf-${Math.random().toString(36).slice(2)}`,
          title: "Shell",
          hasUnread: false,
          opened: false,
          ptyId: -1,
          terminal: { focus: vi.fn() },
        };
        pane.surfaces.push(surface);
        if (!pane.activeSurfaceId) pane.activeSurfaceId = surface.id;
        return surface;
      },
    ),
}));

describe("createWorkspaceFromDef — duplicate id guard", () => {
  beforeEach(() => {
    resetWorkspacesForTest();
    rootRowOrder.set([]);
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("does not duplicate a Branch when called twice with the same id", async () => {
    await createWorkspaceFromDef({
      id: "branch-1",
      name: "Branch 1",
      rootWorkspaceId: "root-1",
    });
    await createWorkspaceFromDef({
      id: "branch-1",
      name: "Branch 1",
      rootWorkspaceId: "root-1",
    });

    const list = get(workspaces);
    expect(list.filter((w) => w.id === "branch-1")).toHaveLength(1);
  });

  it("does not duplicate a Dashboard when called twice with the same id", async () => {
    await createWorkspaceFromDef({
      id: "dash-1",
      name: "Dashboard 1",
      rootWorkspaceId: "root-1",
      isDashboard: true,
      dashboardContributionId: "core.overview",
    });
    await createWorkspaceFromDef({
      id: "dash-1",
      name: "Dashboard 1",
      rootWorkspaceId: "root-1",
      isDashboard: true,
      dashboardContributionId: "core.overview",
    });

    const list = get(workspaces);
    expect(list.filter((w) => w.id === "dash-1")).toHaveLength(1);
  });
});
