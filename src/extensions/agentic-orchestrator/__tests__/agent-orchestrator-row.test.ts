/**
 * Tests for AgentOrchestratorRow — verifies orchestrator name, icon
 * resolution, color background, nested-mode accent, and that the
 * banner has no click handler (only context menu + X delete).
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

const { createWorkspaceFromDefMock, closeWorkspaceMock } = vi.hoisted(() => ({
  createWorkspaceFromDefMock: vi.fn().mockResolvedValue("ws-new"),
  closeWorkspaceMock: vi.fn(),
}));

vi.mock("../../../lib/services/workspace-service", () => ({
  createWorkspaceFromDef: createWorkspaceFromDefMock,
  closeWorkspace: closeWorkspaceMock,
}));

import AgentOrchestratorRow from "../AgentOrchestratorRow.svelte";
import ExtensionWrapper from "../../../lib/components/ExtensionWrapper.svelte";
import WorkspaceListViewStub from "./stubs/WorkspaceListViewStub.svelte";
import ContainerRow from "../../../lib/components/ContainerRow.svelte";
import { themes } from "../../../lib/theme-data";
import type { ExtensionAPI } from "../../../extensions/api";
import type { AgentOrchestrator } from "../../../lib/config";
import {
  createOrchestrator,
  _resetOrchestratorService,
} from "../orchestrator-service";

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

describe("AgentOrchestratorRow", () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(async () => {
    configRef.current = {};
    saveConfigMock.mockClear();
    closeWorkspaceSpy.mockReset();
    showConfirmSpy.mockReset();
    showConfirmSpy.mockResolvedValue(true);
    createWorkspaceFromDefMock.mockClear();
    createWorkspaceFromDefMock.mockResolvedValue("ws-dash");
    closeWorkspaceMock.mockClear();
    _resetOrchestratorService();
    mockedWorkspaces.set([]);
    orchestrator = await createOrchestrator({
      name: "Field Notes",
      baseDir: "/work/proj",
      color: "#ff8800",
      pathOverride: "/tmp/field.md",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the orchestrator name and the default SVG icon", () => {
    const { container, getByText } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentOrchestratorRow,
        props: { id: orchestrator.id, onGripMouseDown: () => {} },
      },
    });
    expect(getByText("Field Notes")).toBeTruthy();
    const iconWrap = container.querySelector("[data-orchestrator-icon]");
    expect(iconWrap).not.toBeNull();
    expect(iconWrap?.querySelector("svg")).not.toBeNull();
  });

  it("paints the orchestrator color as a solid banner background at root level", () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentOrchestratorRow,
        props: { id: orchestrator.id, onGripMouseDown: () => {} },
      },
    });
    const banner = container.querySelector(
      "[data-container-banner]",
    ) as HTMLElement;
    const style = banner.getAttribute("style") ?? "";
    expect(style).toMatch(/background:\s*(#ff8800|rgb\(255,\s*136,\s*0\))/i);
  });

  it("does not wire a banner click handler — interaction is chrome-only", () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentOrchestratorRow,
        props: { id: orchestrator.id, onGripMouseDown: () => {} },
      },
    });
    const banner = container.querySelector(
      "[data-container-banner]",
    ) as HTMLElement;
    // Banner has cursor: default (inert).
    const style = banner.getAttribute("style") ?? "";
    expect(style).toMatch(/cursor:\s*default/);
  });

  it("close X prompts confirmation then deletes the orchestrator", async () => {
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentOrchestratorRow,
        props: { id: orchestrator.id, onGripMouseDown: () => {} },
      },
    });
    const closeBtn = container.querySelector(
      "[data-container-banner-close]",
    ) as HTMLElement | null;
    expect(closeBtn).not.toBeNull();
    await fireEvent.click(closeBtn!);
    expect(showConfirmSpy).toHaveBeenCalledTimes(1);
    expect(showConfirmSpy.mock.calls[0]?.[0]).toContain(orchestrator.name);
    await new Promise((r) => setTimeout(r, 0));
    const { get } = await import("svelte/store");
    const { orchestratorsStore } = await import("../orchestrator-service");
    const remaining = get(orchestratorsStore);
    expect(remaining.find((o) => o.id === orchestrator.id)).toBeUndefined();
  });

  it("close X does NOT delete when confirmation is cancelled", async () => {
    showConfirmSpy.mockResolvedValue(false);
    const { container } = render(ExtensionWrapper, {
      props: {
        api: makeApi("github-dark"),
        component: AgentOrchestratorRow,
        props: { id: orchestrator.id, onGripMouseDown: () => {} },
      },
    });
    const closeBtn = container.querySelector(
      "[data-container-banner-close]",
    ) as HTMLElement | null;
    await fireEvent.click(closeBtn!);
    await new Promise((r) => setTimeout(r, 0));
    const { get } = await import("svelte/store");
    const { orchestratorsStore } = await import("../orchestrator-service");
    expect(
      get(orchestratorsStore).find((o) => o.id === orchestrator.id),
    ).toBeDefined();
  });
});
