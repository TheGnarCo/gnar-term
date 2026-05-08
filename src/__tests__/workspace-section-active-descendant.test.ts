/**
 * Regression: in collapsed mode the workspace's rail must be full-width
 * whenever ANY descendant is the active workspace — not only when the
 * Root Workspace itself is selected.
 *
 * Before the fix WorkspaceSectionContent forwarded
 *   hasActiveChild={isPrimaryActive}
 * which left the rail in its narrow inactive width (4px) whenever a
 * Branch or Dashboard child was active. The fix derives
 * `hasActiveDescendant` (root + any descendant whose
 * `rootWorkspaceId === workspace.id`) and forwards that instead.
 *
 * The rail width is the user-visible behavior under test: 4px stripe
 * when nothing in this banner is active, 8px when something is. We
 * render the real WorkspaceSectionContent through the test harness and
 * read the stripe out of the rendered SidebarRail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

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

Element.prototype.animate = vi.fn().mockImplementation(() => {
  let _onfinish: (() => void) | null = null;
  return {
    get onfinish() {
      return _onfinish;
    },
    set onfinish(fn: (() => void) | null) {
      _onfinish = fn;
      if (fn) fn();
    },
    cancel: vi.fn(),
  };
});

import WorkspaceSectionHarness from "./workspace-section-harness.svelte";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { sidebarVisible } from "../lib/stores/ui";
import type { Workspace } from "../lib/types";

const ROOT_ID = "root-1";

function makeRoot(): Workspace {
  return {
    id: ROOT_ID,
    name: "Root",
    paneLayout: {
      type: "pane",
      pane: { id: "p-root", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p-root",
    color: "purple",
    path: "/tmp/root",
    isGit: true,
    branchedWorkspaceIds: ["branch-1", "dash-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Workspace;
}

function makeBranch(): Workspace {
  return {
    id: "branch-1",
    name: "Feature Branch",
    rootWorkspaceId: ROOT_ID,
    worktreePath: "/tmp/root-branch",
    branch: "feature",
    paneLayout: {
      type: "pane",
      pane: { id: "p-branch", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p-branch",
  } as Workspace;
}

function makeDashboard(): Workspace {
  return {
    id: "dash-1",
    name: "Overview",
    rootWorkspaceId: ROOT_ID,
    isDashboard: true,
    dashboardContributionId: "test-overview",
    paneLayout: {
      type: "pane",
      pane: { id: "p-dash", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p-dash",
  } as Workspace;
}

function makeUnrelated(): Workspace {
  return {
    id: "other-root",
    name: "Other",
    paneLayout: {
      type: "pane",
      pane: { id: "p-other", surfaces: [], activeSurfaceId: null },
    },
    activePaneId: "p-other",
    color: "mint",
    path: "/tmp/other",
    isGit: false,
    branchedWorkspaceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Workspace;
}

// The root banner's full-height rail is the first `[data-sidebar-rail="container"]`
// inside the root banner block; the painted stripe is its grip's first child div.
// Its width reflects the active/descendant/popover state — 4px inactive, 8px active.
function railStripeWidth(container: HTMLElement): string | null {
  const rail = container.querySelector(
    '[data-sidebar-banner-mode="root"] > [data-sidebar-rail="container"] .drag-grip > div',
  ) as HTMLElement | null;
  return rail?.style.width ?? null;
}

describe("WorkspaceSectionContent — collapsed rail tracks any descendant", () => {
  beforeEach(() => {
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
    sidebarVisible.set(false);
  });
  afterEach(() => {
    cleanup();
    sidebarVisible.set(true);
    workspaces.set([]);
    activeWorkspaceIdx.set(-1);
  });

  it("widens the rail to 8px when an unrelated workspace becomes the Root itself", async () => {
    workspaces.set([
      makeRoot(),
      makeBranch(),
      makeDashboard(),
      makeUnrelated(),
    ]);
    activeWorkspaceIdx.set(0); // Root is active
    const { container } = render(WorkspaceSectionHarness, {
      props: { rootWorkspaceId: ROOT_ID },
    });
    await tick();
    expect(railStripeWidth(container)).toBe("8px");
  });

  it("widens the rail to 8px when a Branch descendant is active", async () => {
    workspaces.set([
      makeRoot(),
      makeBranch(),
      makeDashboard(),
      makeUnrelated(),
    ]);
    activeWorkspaceIdx.set(1); // Branch under Root
    const { container } = render(WorkspaceSectionHarness, {
      props: { rootWorkspaceId: ROOT_ID },
    });
    await tick();
    expect(railStripeWidth(container)).toBe("8px");
  });

  it("widens the rail to 8px when a Dashboard descendant is active", async () => {
    workspaces.set([
      makeRoot(),
      makeBranch(),
      makeDashboard(),
      makeUnrelated(),
    ]);
    activeWorkspaceIdx.set(2); // Dashboard under Root
    const { container } = render(WorkspaceSectionHarness, {
      props: { rootWorkspaceId: ROOT_ID },
    });
    await tick();
    expect(railStripeWidth(container)).toBe("8px");
  });

  it("keeps the rail at 4px when an unrelated workspace is active", async () => {
    workspaces.set([
      makeRoot(),
      makeBranch(),
      makeDashboard(),
      makeUnrelated(),
    ]);
    activeWorkspaceIdx.set(3); // Unrelated workspace
    const { container } = render(WorkspaceSectionHarness, {
      props: { rootWorkspaceId: ROOT_ID },
    });
    await tick();
    expect(railStripeWidth(container)).toBe("4px");
  });
});
