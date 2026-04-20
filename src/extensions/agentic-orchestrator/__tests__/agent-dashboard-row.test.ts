/**
 * Tests for AgentDashboardRow — verifies dashboard name, icon resolution,
 * color border vs nested-mode accent strip, and click → openDashboard.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
import { writable } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "get_home") return "/home/test";
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const { openSpy } = vi.hoisted(() => ({ openSpy: vi.fn() }));

// Mock the dashboard service so we can isolate openDashboard's invocation
// AND keep dashboardScopedAgents/getDashboard/dashboardsStore working.
vi.mock("../dashboard-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dashboard-service")>();
  return {
    ...actual,
    openDashboard: openSpy,
  };
});

import AgentDashboardRow from "../AgentDashboardRow.svelte";
import ExtensionWrapper from "../../../lib/components/ExtensionWrapper.svelte";
import WorkspaceListViewStub from "./stubs/WorkspaceListViewStub.svelte";
import ContainerRow from "../../../lib/components/ContainerRow.svelte";
import { themes } from "../../../lib/theme-data";
import type { ExtensionAPI } from "../../../extensions/api";
import type { AgentDashboard } from "../../../lib/config";
import { createDashboard, _resetDashboardService } from "../dashboard-service";

const closeWorkspaceSpy = vi.fn();
const showConfirmSpy = vi.fn().mockResolvedValue(true);

const { configRef, saveConfigMock } = vi.hoisted(() => {
  const ref: { current: Record<string, unknown> } = { current: {} };
  return {
    configRef: ref,
    saveConfigMock: vi.fn(async (updates: Record<string, unknown>) => {
      ref.current = { ...ref.current, ...updates };
    }),
  };
});

vi.mock("../../../lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config")>();
  return {
    ...actual,
    getConfig: () => configRef.current,
    saveConfig: saveConfigMock,
  };
});

vi.mock("../../../lib/stores/workspace", async () => {
  const { writable: w, derived } = await import("svelte/store");
  const workspaces = w<Array<Record<string, unknown>>>([]);
  const activeWorkspaceIdx = w<number>(-1);
  const activeWorkspace = derived(
    [workspaces, activeWorkspaceIdx],
    ([$ws, $idx]) => ($idx >= 0 && $idx < $ws.length ? $ws[$idx] : null),
  );
  return {
    workspaces,
    activeWorkspaceIdx,
    activeWorkspace,
    activePane: w<{ id: string } | null>({ id: "p" }),
    activeSurface: w<unknown>(null),
  };
});

import { workspaces as mockedWorkspaces } from "../../../lib/stores/workspace";

function makeApi(
  themeId: keyof typeof themes,
  opts: { workspaceListView?: unknown } = {},
): ExtensionAPI {
  const stateMap = new Map<string, unknown>();
  return {
    state: {
      get: <T>(key: string) => stateMap.get(key) as T | undefined,
      set: (key: string, v: unknown) => {
        stateMap.set(key, v);
      },
    },
    theme: writable(themes[themeId]),
    agents: writable([]),
    workspaces: mockedWorkspaces,
    reorderContext: writable(null),
    childRowContributors: writable([]),
    getChildRowsFor: () => [],
    getRootRowRenderer: () => undefined,
    getComponents: () => ({
      WorkspaceListView: opts.workspaceListView ?? WorkspaceListViewStub,
      SplitButton: null,
      ColorPicker: null,
      DragGrip: null,
      DropGhost: null,
      ContainerRow,
    }),
    closeWorkspace: (id: string) => closeWorkspaceSpy(id),
    showConfirm: (
      message: string,
      options?: Record<string, unknown>,
    ): Promise<boolean> => showConfirmSpy(message, options),
  } as unknown as ExtensionAPI;
}

describe("AgentDashboardRow", () => {
  let dashboard: AgentDashboard;

  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    openSpy.mockReset();
    closeWorkspaceSpy.mockReset();
    showConfirmSpy.mockReset();
    showConfirmSpy.mockResolvedValue(true);
    _resetDashboardService();
    mockedWorkspaces.set([]);
    dashboard = await createDashboard({
      name: "Field Notes",
      baseDir: "/work/proj",
      color: "#ff8800",
      pathOverride: "/tmp/field.md",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the dashboard name and the default SVG icon", () => {
    const { container, getByText } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    expect(getByText("Field Notes")).toBeTruthy();
    const iconWrap = container.querySelector("[data-dashboard-icon]");
    expect(iconWrap).not.toBeNull();
    // Default theme glyph is the inline layout-dashboard SVG.
    expect(iconWrap?.querySelector("svg")).not.toBeNull();
  });

  it("renders an emoji glyph when the active theme overrides dashboardIcon", () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("molly-disco"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const iconWrap = container.querySelector("[data-dashboard-icon]");
    expect(iconWrap?.textContent?.trim()).toBe("🪩");
    expect(iconWrap?.querySelector("svg")).toBeNull();
  });

  it("paints the dashboard color as a solid banner background at root level", () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const banner = container.querySelector(
      "[data-container-banner]",
    ) as HTMLElement;
    const style = banner.getAttribute("style") ?? "";
    // jsdom serializes hex to rgb(); accept either form.
    expect(style).toMatch(/background:\s*(#ff8800|rgb\(255,\s*136,\s*0\))/i);
  });

  it("paints the banner solid in the dashboard color when nested under a project", () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, parentColor: "#3366ff" },
      },
    });
    const banner = container.querySelector(
      "[data-container-banner]",
    ) as HTMLElement;
    const style = banner.getAttribute("style") ?? "";
    // Nested rows opt out of the full-row border.
    expect(style).not.toMatch(/\bborder:/);
    // Banner paints the dashboard color as its background.
    expect(style).toMatch(/background:\s*(#ff8800|rgb\(255,\s*136,\s*0\))/i);
  });

  it("invokes openDashboard when the banner is clicked", async () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const banner = container.querySelector(
      "[data-container-banner]",
    ) as HTMLElement;
    await fireEvent.click(banner);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]?.id).toBe(dashboard.id);
  });

  it("does not render the nested-workspaces wrapper when no workspaces match", () => {
    // One unrelated workspace — no metadata.parentDashboardId match.
    mockedWorkspaces.set([
      {
        id: "ws-other",
        name: "Unrelated",
        splitRoot: { type: "pane", pane: { id: "p1", surfaces: [] } },
        activePaneId: "p1",
        metadata: {},
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    expect(container.querySelector("[data-container-nested]")).toBeNull();
  });

  it("renders the nested-workspaces wrapper with the count of matching workspaces", () => {
    mockedWorkspaces.set([
      {
        id: "ws-a",
        name: "Worktree Alpha",
        splitRoot: { type: "pane", pane: { id: "p1", surfaces: [] } },
        activePaneId: "p1",
        metadata: { parentDashboardId: dashboard.id },
      },
      {
        id: "ws-other",
        name: "Unrelated",
        splitRoot: { type: "pane", pane: { id: "p2", surfaces: [] } },
        activePaneId: "p2",
        metadata: {},
      },
      {
        id: "ws-b",
        name: "Worktree Beta",
        splitRoot: { type: "pane", pane: { id: "p3", surfaces: [] } },
        activePaneId: "p3",
        metadata: { parentDashboardId: dashboard.id },
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const wrapper = container.querySelector(
      `[data-container-nested="${dashboard.id}"]`,
    ) as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("data-nested-count")).toBe("2");
  });

  it("renders the nested-workspaces wrapper in the project-nested banner variant too", () => {
    mockedWorkspaces.set([
      {
        id: "ws-a",
        name: "Worktree Alpha",
        splitRoot: { type: "pane", pane: { id: "p1", surfaces: [] } },
        activePaneId: "p1",
        metadata: { parentDashboardId: dashboard.id },
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, parentColor: "#3366ff" },
      },
    });
    const wrapper = container.querySelector(
      `[data-container-nested="${dashboard.id}"]`,
    );
    expect(wrapper).not.toBeNull();
  });

  it("does NOT include the dashboard-hosting workspace in the nested list — the banner represents it", async () => {
    mockedWorkspaces.set([
      {
        id: "ws-host",
        name: "Dashboard",
        splitRoot: { type: "pane", pane: { id: "p0", surfaces: [] } },
        activePaneId: "p0",
        metadata: { dashboardId: dashboard.id },
      },
      {
        id: "ws-spawn",
        name: "Worktree Alpha",
        splitRoot: { type: "pane", pane: { id: "p1", surfaces: [] } },
        activePaneId: "p1",
        metadata: { parentDashboardId: dashboard.id },
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark", {
          workspaceListView: WorkspaceListViewStub,
        }),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    // Hosting workspace row should not render — the banner represents it.
    expect(container.querySelector('[data-stub-row="ws-host"]')).toBeNull();
    // Spawned worktree renders normally.
    expect(
      container.querySelector('[data-stub-row="ws-spawn"]'),
    ).not.toBeNull();
  });

  it("close X prompts confirmation then deletes the dashboard entity", async () => {
    mockedWorkspaces.set([
      {
        id: "ws-host",
        name: "Dashboard",
        splitRoot: { type: "pane", pane: { id: "p0", surfaces: [] } },
        activePaneId: "p0",
        metadata: { dashboardId: dashboard.id },
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const closeBtn = container.querySelector(
      "[data-container-banner-close]",
    ) as HTMLElement | null;
    expect(closeBtn).not.toBeNull();
    await fireEvent.click(closeBtn!);
    expect(showConfirmSpy).toHaveBeenCalledTimes(1);
    // Message should mention the dashboard's name so the user knows what
    // they're deleting.
    expect(showConfirmSpy.mock.calls[0]?.[0]).toContain(dashboard.name);
    // deleteDashboard removes it from the dashboards store after confirm.
    // The dashboards store rebuild is async via saveConfig; let the
    // promise settle and inspect.
    await new Promise((r) => setTimeout(r, 0));
    const { get } = await import("svelte/store");
    const { dashboardsStore } = await import("../dashboard-service");
    const remaining = get(dashboardsStore);
    expect(remaining.find((d) => d.id === dashboard.id)).toBeUndefined();
  });

  it("close X does NOT delete when confirmation is cancelled", async () => {
    showConfirmSpy.mockResolvedValue(false);
    mockedWorkspaces.set([
      {
        id: "ws-host",
        name: "Dashboard",
        splitRoot: { type: "pane", pane: { id: "p0", surfaces: [] } },
        activePaneId: "p0",
        metadata: { dashboardId: dashboard.id },
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const closeBtn = container.querySelector(
      "[data-container-banner-close]",
    ) as HTMLElement | null;
    await fireEvent.click(closeBtn!);
    await new Promise((r) => setTimeout(r, 0));
    const { get } = await import("svelte/store");
    const { dashboardsStore } = await import("../dashboard-service");
    expect(
      get(dashboardsStore).find((d) => d.id === dashboard.id),
    ).toBeDefined();
  });

  it("does not pass hideStatusBadges=true to WorkspaceListView — worktrees show their own status", async () => {
    mockedWorkspaces.set([
      {
        id: "ws-spawn",
        name: "Worktree Alpha",
        splitRoot: { type: "pane", pane: { id: "p1", surfaces: [] } },
        activePaneId: "p1",
        metadata: { parentDashboardId: dashboard.id },
      },
    ]);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark", {
          workspaceListView: WorkspaceListViewStub,
        }),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const stub = container.querySelector(
      "[data-workspace-list-view-stub]",
    ) as HTMLElement | null;
    expect(stub).not.toBeNull();
    // Stub exposes hideStatusBadges on a data attribute — see
    // WorkspaceListViewStub.svelte.
    expect(stub?.getAttribute("data-hide-status-badges")).not.toBe("true");
  });
});
