/**
 * Regression test for "Settings / Claude Settings never appear in the sidebar":
 *
 * Standalone Dashboard Workspaces (those spawned by `spawnOrNavigate` from
 * a `registerGlobalSurface` button — Settings, Claude Settings, etc.)
 * land in `_workspaces` with `isDashboard: true`,
 * `dashboardContributionId: id`, and NO `rootWorkspaceId`. The runtime
 * service appends a
 * `{ kind: "workspace", id }` row for them in `rootRowOrder` and the
 * registered "workspace" renderer (WorkspaceRowBody → WorkspaceSectionContent)
 * is used to draw the row.
 *
 * `WorkspaceSectionContent` looks the row up via `getWorkspace(id)`, which
 * filters through `isRootWorkspace` — that predicate returns false for
 * `isDashboard === true` workspaces. The component then short-circuits with
 * `{#if workspace}`, and the row renders blank. Result: the standalone
 * Dashboard Workspace exists in the store, has a row in the order, and
 * yet is invisible to the user.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tick } from "svelte";
import { render, screen, cleanup } from "@testing-library/svelte";

// ---------------------------------------------------------------------------
// Mocks — must come before any component imports
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
  writeImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    onTitleChange: vi.fn(),
    loadAddon: vi.fn(),
    options: {},
    buffer: { active: { getLine: vi.fn(), length: 0 } },
    rows: 24,
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn(),
    hasSelection: vi.fn().mockReturnValue(false),
    onSelectionChange: vi.fn(),
    scrollToBottom: vi.fn(),
    onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  })),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    onContextLoss: vi.fn(),
  })),
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    clearDecorations: vi.fn(),
  })),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import Sidebar from "../lib/components/Sidebar.svelte";
import WorkspaceRowBody from "../lib/components/WorkspaceRowBody.svelte";
import GearIcon from "../lib/icons/GearIcon.svelte";
import { sidebarVisible } from "../lib/stores/ui";
import {
  workspaces,
  activeWorkspaceIdx,
  resetWorkspacesForTest,
} from "../lib/stores/workspace";
import { rootRowOrder } from "../lib/stores/root-row-order";
import { registerRootRowRenderer } from "../lib/services/root-row-renderer-registry";
import {
  registerGlobalSurface,
  clearGlobalSurfaceRegistry,
} from "../lib/services/global-surface-service";
import { initCoreExtensionAPI } from "../lib/bootstrap/init-core-extension-api";
import { resetSidebarSections } from "../lib/services/sidebar-section-registry";
import { resetWorkspaceActions } from "../lib/services/workspace-action-registry";
import type { Workspace } from "../lib/types";

const noop = () => {};

const sidebarProps = {
  onSwitchWorkspace: noop,
  onRenameWorkspace: noop,
  onNewSurface: noop,
};

function makeStandaloneDashboardWorkspace(
  id: string,
  name: string,
  dashboardContributionId: string,
): Workspace {
  return {
    id,
    name,
    paneLayout: {
      type: "pane",
      pane: { id: `${id}-p1`, surfaces: [], activeSurfaceId: null },
    },
    activePaneId: `${id}-p1`,
    isDashboard: true,
    dashboardContributionId,
  };
}

describe("standalone Dashboard Workspaces render in the sidebar", () => {
  beforeEach(() => {
    cleanup();
    resetSidebarSections();
    resetWorkspaceActions();
    clearGlobalSurfaceRegistry();
    workspaces.set([]);
    rootRowOrder.set([]);
    activeWorkspaceIdx.set(-1);
    resetWorkspacesForTest();
    sidebarVisible.set(true);

    // The "workspace" root-row renderer is registered by initWorkspaces()
    // in production. Tests register it manually so WorkspaceListBlock can
    // resolve it for kind:"workspace" rows.
    initCoreExtensionAPI();
    registerRootRowRenderer({
      id: "workspace",
      source: "core",
      component: WorkspaceRowBody,
      label: (id: string) => {
        let result: string | undefined;
        workspaces.subscribe((list) => {
          result = list.find((w) => w.id === id)?.name;
        })();
        return result;
      },
    });

    // Production wires this in App.svelte before extensions activate.
    registerGlobalSurface({
      id: "gnar-term:settings",
      label: "Settings",
      icon: GearIcon as unknown as import("svelte").Component,
      component: GearIcon as unknown as import("svelte").Component,
      accentColor: "#8998A8",
    });
  });

  it("renders the workspace name for a standalone Dashboard Workspace", async () => {
    // Simulate `spawnOrNavigate("gnar-term:settings")` having created a
    // standalone Dashboard Workspace (no rootWorkspaceId).
    const dash = makeStandaloneDashboardWorkspace(
      "settings-1",
      "Settings",
      "gnar-term:settings",
    );
    workspaces.set([dash]);
    rootRowOrder.set([{ kind: "workspace", id: "settings-1" }]);
    activeWorkspaceIdx.set(0);

    render(Sidebar, { props: sidebarProps });
    await tick();

    // The standalone Dashboard Workspace's name MUST be visible in the
    // sidebar — this is what's broken in the current build.
    expect(screen.getByText("Settings")).toBeTruthy();
  });
});
