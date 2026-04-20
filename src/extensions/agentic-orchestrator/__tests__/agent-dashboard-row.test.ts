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
import { themes } from "../../../lib/theme-data";
import type { ExtensionAPI } from "../../../extensions/api";
import type { AgentDashboard } from "../../../lib/config";
import { createDashboard, _resetDashboardService } from "../dashboard-service";

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
  const { writable: w } = await import("svelte/store");
  return {
    workspaces: w<Array<Record<string, unknown>>>([]),
    activePane: w<{ id: string } | null>({ id: "p" }),
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
      WorkspaceListView: opts.workspaceListView ?? null,
      SplitButton: null,
      ColorPicker: null,
      DragGrip: null,
      DropGhost: null,
    }),
  } as unknown as ExtensionAPI;
}

describe("AgentDashboardRow", () => {
  let dashboard: AgentDashboard;

  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    openSpy.mockReset();
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
    const row = container.querySelector("[data-dashboard-id]") as HTMLElement;
    const style = row.getAttribute("style") ?? "";
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
    const row = container.querySelector("[data-dashboard-id]") as HTMLElement;
    const style = row.getAttribute("style") ?? "";
    // Nested rows opt out of the full-row border.
    expect(style).not.toMatch(/\bborder:/);
    // Banner paints the dashboard color as its background.
    expect(style).toMatch(/background:\s*(#ff8800|rgb\(255,\s*136,\s*0\))/i);
  });

  it("invokes openDashboard when the row is clicked", async () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentDashboardRow,
        props: { id: dashboard.id, onGripMouseDown: () => {} },
      },
    });
    const row = container.querySelector("[data-dashboard-id]") as HTMLElement;
    await fireEvent.click(row);
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
    expect(
      container.querySelector("[data-dashboard-nested-workspaces]"),
    ).toBeNull();
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
      `[data-dashboard-nested-workspaces="${dashboard.id}"]`,
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
      `[data-dashboard-nested-workspaces="${dashboard.id}"]`,
    );
    expect(wrapper).not.toBeNull();
  });

  it("produces a hint only for hosting workspaces (metadata.dashboardId), not for spawned worktrees", async () => {
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
    const host = container.querySelector(
      '[data-stub-row="ws-host"]',
    ) as HTMLElement | null;
    const spawn = container.querySelector(
      '[data-stub-row="ws-spawn"]',
    ) as HTMLElement | null;
    expect(host?.getAttribute("data-stub-hint-id")).toBe(dashboard.id);
    expect(spawn?.getAttribute("data-stub-hint-id")).toBe("");

    await fireEvent.click(host!);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]?.id).toBe(dashboard.id);

    await fireEvent.click(spawn!);
    // Clicking a non-hosting row's stub (no hint) must not call openDashboard.
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});
