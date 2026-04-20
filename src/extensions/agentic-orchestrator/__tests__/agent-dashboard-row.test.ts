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
    workspaces: w([]),
    activePane: w<{ id: string } | null>({ id: "p" }),
  };
});

function makeApi(themeId: keyof typeof themes): ExtensionAPI {
  const stateMap = new Map<string, unknown>();
  stateMap.set("detectedAgents", []);
  return {
    state: {
      get: <T>(key: string) => stateMap.get(key) as T | undefined,
      set: (key: string, v: unknown) => {
        stateMap.set(key, v);
      },
    },
    theme: writable(themes[themeId]),
    reorderContext: writable(null),
    childRowContributors: writable([]),
    getChildRowsFor: () => [],
    getRootRowRenderer: () => undefined,
    getComponents: () => ({
      WorkspaceListView: null,
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
});
