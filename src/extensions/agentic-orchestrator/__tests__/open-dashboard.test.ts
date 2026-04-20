/**
 * Tests for openDashboard + ensureDashboardSurface. Verifies the
 * per-dashboard workspace bookkeeping: existing-surface dedup, switching
 * to an already-created dashboard workspace, and lazy workspace creation
 * on first open.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const { focusSpy, createSpy } = vi.hoisted(() => ({
  focusSpy: vi.fn(),
  createSpy: vi.fn(),
}));

vi.mock("../../../lib/services/surface-service", () => ({
  focusSurfaceById: focusSpy,
  createPreviewSurfaceInPane: createSpy,
}));

const { findByPathSpy } = vi.hoisted(() => ({
  findByPathSpy: vi.fn(),
}));

vi.mock("../../../lib/services/preview-surface-registry", () => ({
  findPreviewSurfaceByPath: findByPathSpy,
}));

const { createWorkspaceFromDefSpy } = vi.hoisted(() => ({
  createWorkspaceFromDefSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: createWorkspaceFromDefSpy,
}));

vi.mock("../../../lib/stores/workspace", async () => {
  const { writable } = await import("svelte/store");
  return {
    workspaces: writable<Array<Record<string, unknown>>>([]),
    activePane: writable<{ id: string } | null>({ id: "pane-active" }),
    activeWorkspaceIdx: writable<number>(-1),
  };
});

import type { AgentDashboard } from "../../../lib/config";
import {
  openDashboard,
  ensureDashboardSurface,
  DASHBOARD_WORKSPACE_META_KEY,
} from "../dashboard-service";
import {
  workspaces,
  activePane,
  activeWorkspaceIdx,
} from "../../../lib/stores/workspace";

const fixture: AgentDashboard = {
  id: "d-1",
  name: "Sample",
  baseDir: "/work/proj",
  color: "purple",
  path: "/home/test/.config/gnar-term/dashboards/d-1.md",
  createdAt: "2026-04-19T00:00:00.000Z",
};

function setWorkspaces(list: Array<Record<string, unknown>>) {
  (workspaces as unknown as { set: (v: unknown) => void }).set(list);
}
function setActivePane(pane: { id: string } | null) {
  (activePane as unknown as { set: (v: unknown) => void }).set(pane);
}

describe("openDashboard", () => {
  beforeEach(() => {
    focusSpy.mockReset();
    createSpy.mockReset();
    findByPathSpy.mockReset();
    createWorkspaceFromDefSpy.mockReset();
    createWorkspaceFromDefSpy.mockResolvedValue(undefined);
    setWorkspaces([]);
    setActivePane({ id: "pane-active" });
    (activeWorkspaceIdx as unknown as { set: (v: number) => void }).set(-1);
  });

  it("focuses an existing preview surface when one is registered for the path", () => {
    findByPathSpy.mockReturnValue({
      surfaceId: "s-existing",
      path: fixture.path,
      paneId: "pane-other",
      workspaceId: "ws-other",
    });

    const ok = openDashboard(fixture);

    expect(ok).toBe(true);
    expect(focusSpy).toHaveBeenCalledWith("s-existing");
    expect(createSpy).not.toHaveBeenCalled();
    expect(createWorkspaceFromDefSpy).not.toHaveBeenCalled();
  });

  it("creates a dedicated workspace on first open, tagged with dashboardId", () => {
    findByPathSpy.mockReturnValue(undefined);

    const ok = openDashboard(fixture);

    expect(ok).toBe(true);
    expect(createWorkspaceFromDefSpy).toHaveBeenCalledTimes(1);
    const def = createWorkspaceFromDefSpy.mock.calls[0]![0] as {
      name: string;
      metadata?: Record<string, unknown>;
      layout: { pane: { surfaces: Array<{ type: string; path: string }> } };
    };
    expect(def.name).toBe(fixture.name);
    expect(def.metadata?.[DASHBOARD_WORKSPACE_META_KEY]).toBe(fixture.id);
    expect(def.layout.pane.surfaces[0]).toMatchObject({
      type: "preview",
      path: fixture.path,
    });
  });

  it("reuses the dedicated workspace on subsequent opens and spawns the surface if missing", () => {
    findByPathSpy.mockReturnValue(undefined);
    setWorkspaces([
      {
        id: "ws-dash",
        name: "Sample",
        splitRoot: {
          type: "pane",
          pane: {
            id: "pane-dash",
            surfaces: [],
            activeSurfaceId: null,
          },
        },
        activePaneId: "pane-dash",
        metadata: { [DASHBOARD_WORKSPACE_META_KEY]: fixture.id },
      },
    ]);
    createSpy.mockReturnValue({ id: "s-new" });

    const ok = openDashboard(fixture);

    expect(ok).toBe(true);
    expect(createWorkspaceFromDefSpy).not.toHaveBeenCalled();
    expect(get(activeWorkspaceIdx)).toBe(0);
    expect(createSpy).toHaveBeenCalledWith(
      "pane-dash",
      fixture.path,
      expect.objectContaining({ focus: true, title: fixture.name }),
    );
  });
});

describe("ensureDashboardSurface", () => {
  beforeEach(() => {
    focusSpy.mockReset();
    createSpy.mockReset();
    findByPathSpy.mockReset();
    setWorkspaces([]);
  });

  it("spawns the dashboard surface when the dedicated workspace has no match", () => {
    setWorkspaces([
      {
        id: "ws-dash",
        name: "Sample",
        splitRoot: {
          type: "pane",
          pane: {
            id: "pane-dash",
            surfaces: [],
            activeSurfaceId: null,
          },
        },
        activePaneId: "pane-dash",
        metadata: { [DASHBOARD_WORKSPACE_META_KEY]: fixture.id },
      },
    ]);

    ensureDashboardSurface(fixture);

    expect(createSpy).toHaveBeenCalledWith(
      "pane-dash",
      fixture.path,
      expect.objectContaining({ focus: true, title: fixture.name }),
    );
  });

  it("does nothing when the dedicated workspace already has a matching preview surface", () => {
    setWorkspaces([
      {
        id: "ws-dash",
        name: "Sample",
        splitRoot: {
          type: "pane",
          pane: {
            id: "pane-dash",
            surfaces: [
              {
                kind: "preview",
                id: "s-existing",
                title: "Sample",
                path: fixture.path,
                hasUnread: false,
              },
            ],
            activeSurfaceId: "s-existing",
          },
        },
        activePaneId: "pane-dash",
        metadata: { [DASHBOARD_WORKSPACE_META_KEY]: fixture.id },
      },
    ]);

    ensureDashboardSurface(fixture);

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when no dedicated workspace exists yet", () => {
    ensureDashboardSurface(fixture);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
