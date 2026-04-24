/**
 * Tests for workspace-service, pane-service, and surface-service.
 *
 * These tests exercise the store-based functions by setting up workspaces
 * directly in stores and calling service functions, then asserting on
 * store state and emitted events.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";

// --- Mocks (must be before service imports) ---

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/terminal-service", () => ({
  createTerminalSurface: vi.fn(),
  isMac: false,
}));

vi.mock("../lib/config", () => ({
  saveState: vi.fn().mockResolvedValue(undefined),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockReturnValue({ commands: [] }),
}));

vi.mock("../lib/services/service-helpers", () => ({
  safeFocus: vi.fn(),
  getActiveCwd: vi.fn().mockResolvedValue(undefined),
  getCwdForSurface: vi.fn().mockResolvedValue(undefined),
}));

// --- Imports ---

import {
  workspaces,
  activeWorkspaceIdx,
  activeWorkspace,
} from "../lib/stores/workspace";
import type {
  Workspace,
  Pane,
  TerminalSurface,
  ExtensionSurface,
  SplitNode,
} from "../lib/types";
import { uid } from "../lib/types";
import { eventBus } from "../lib/services/event-bus";
import type { AppEvent } from "../lib/services/event-bus";

import {
  switchWorkspace,
  closeWorkspace,
  renameWorkspace,
  reorderWorkspaces,
  serializeLayout,
  persistWorkspaces,
  schedulePersist,
} from "../lib/services/workspace-service";

import {
  focusPane,
  reorderTab,
  focusDirection,
  removePane,
} from "../lib/services/pane-service";

import {
  selectSurface,
  nextSurface,
  prevSurface,
  selectSurfaceByNumber,
  closeActiveSurface,
  openExtensionSurfaceInPane,
} from "../lib/services/surface-service";

import { saveState } from "../lib/config";
import { invoke } from "@tauri-apps/api/core";

// --- Test helpers ---

function mockTerminalSurface(
  overrides: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id: uid(),
    terminal: {
      dispose: vi.fn(),
      focus: vi.fn(),
    } as unknown as TerminalSurface["terminal"],
    fitAddon: { fit: vi.fn() } as unknown as TerminalSurface["fitAddon"],
    searchAddon: {} as unknown as TerminalSurface["searchAddon"],
    termElement: document.createElement("div"),
    ptyId: 1,
    title: "test",
    hasUnread: false,
    opened: true,
    ...overrides,
  };
}

function mockExtensionSurface(
  overrides: Partial<ExtensionSurface> = {},
): ExtensionSurface {
  return {
    kind: "extension",
    id: uid(),
    surfaceTypeId: "test:panel",
    title: "Test Extension",
    hasUnread: false,
    props: {},
    ...overrides,
  };
}

function makePane(
  surfaces?: TerminalSurface[],
  overrides: Partial<Pane> = {},
): Pane {
  const surfs = surfaces ?? [mockTerminalSurface()];
  return {
    id: uid(),
    surfaces: surfs,
    activeSurfaceId: surfs[0]?.id ?? null,
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  const pane = makePane();
  return {
    id: uid(),
    name: "Workspace 1",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...overrides,
  };
}

/** Collect events emitted during a callback. */
function collectEvents(fn: () => void): AppEvent[] {
  const events: AppEvent[] = [];
  const original = eventBus.emit.bind(eventBus);
  const spy = vi.spyOn(eventBus, "emit").mockImplementation((e: AppEvent) => {
    events.push(e);
    original(e);
  });
  fn();
  spy.mockRestore();
  return events;
}

// --- Setup / Teardown ---

beforeEach(() => {
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================
// workspace-service tests
// ============================================================

describe("workspace-service", () => {
  describe("switchWorkspace", () => {
    it("sets activeWorkspaceIdx to the given index", () => {
      const ws1 = makeWorkspace({ name: "WS1" });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      switchWorkspace(1);

      expect(get(activeWorkspaceIdx)).toBe(1);
    });

    it("emits workspace:activated with correct ids", () => {
      const ws1 = makeWorkspace({ name: "WS1" });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => switchWorkspace(1));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "workspace:activated",
        id: ws2.id,
        previousId: ws1.id,
      });
    });

    it("is a no-op for negative index", () => {
      const ws = makeWorkspace();
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      switchWorkspace(-1);

      expect(get(activeWorkspaceIdx)).toBe(0);
    });

    it("is a no-op for index beyond workspace count", () => {
      const ws = makeWorkspace();
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      switchWorkspace(5);

      expect(get(activeWorkspaceIdx)).toBe(0);
    });

    it("reports previousId as null when no workspace was active", () => {
      const ws = makeWorkspace();
      workspaces.set([ws]);
      activeWorkspaceIdx.set(-1);

      const events = collectEvents(() => switchWorkspace(0));

      expect(events[0]).toMatchObject({
        type: "workspace:activated",
        previousId: null,
      });
    });
  });

  describe("closeWorkspace", () => {
    it("removes the workspace at the given index", () => {
      const ws1 = makeWorkspace({ name: "WS1" });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      closeWorkspace(0);

      const list = get(workspaces);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(ws2.id);
    });

    it("allows closing the last workspace (Empty Surface takes over)", () => {
      const ws = makeWorkspace();
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      closeWorkspace(0);

      expect(get(workspaces)).toHaveLength(0);
      expect(get(activeWorkspaceIdx)).toBe(-1);
    });

    it("clamps activeWorkspaceIdx when closing the last item in the list", () => {
      const ws1 = makeWorkspace({ name: "WS1" });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(1);

      closeWorkspace(1);

      expect(get(activeWorkspaceIdx)).toBe(0);
    });

    it("disposes terminal surfaces and kills PTYs", () => {
      const s = mockTerminalSurface({ ptyId: 42 });
      const pane = makePane([s]);
      const ws1 = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      closeWorkspace(0);

      expect(s.terminal.dispose).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("kill_pty", { ptyId: 42 });
    });

    it("disconnects resize observers on panes", () => {
      const disconnect = vi.fn();
      const pane = makePane();
      pane.resizeObserver = { disconnect } as unknown as ResizeObserver;
      const ws1 = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      closeWorkspace(0);

      expect(disconnect).toHaveBeenCalled();
    });

    it("emits workspace:closed", () => {
      const ws1 = makeWorkspace({ name: "WS1" });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => closeWorkspace(0));

      expect(events).toContainEqual(
        expect.objectContaining({ type: "workspace:closed", id: ws1.id }),
      );
    });
  });

  describe("renameWorkspace", () => {
    it("updates the workspace name", () => {
      const ws = makeWorkspace({ name: "Old Name" });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      renameWorkspace(0, "New Name");

      expect(get(workspaces)[0].name).toBe("New Name");
    });

    it("emits workspace:renamed with old and new names", () => {
      const ws = makeWorkspace({ name: "Alpha" });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => renameWorkspace(0, "Beta"));

      expect(events[0]).toMatchObject({
        type: "workspace:renamed",
        id: ws.id,
        oldName: "Alpha",
        newName: "Beta",
      });
    });
  });

  describe("reorderWorkspaces", () => {
    it("moves a workspace from one index to another", () => {
      const ws1 = makeWorkspace({ name: "A" });
      const ws2 = makeWorkspace({ name: "B" });
      const ws3 = makeWorkspace({ name: "C" });
      workspaces.set([ws1, ws2, ws3]);
      activeWorkspaceIdx.set(0);

      reorderWorkspaces(0, 2);

      const names = get(workspaces).map((w) => w.name);
      expect(names).toEqual(["B", "A", "C"]);
    });

    it("maintains active workspace selection after reorder", () => {
      const ws1 = makeWorkspace({ name: "A" });
      const ws2 = makeWorkspace({ name: "B" });
      const ws3 = makeWorkspace({ name: "C" });
      workspaces.set([ws1, ws2, ws3]);
      activeWorkspaceIdx.set(0); // "A" is active

      reorderWorkspaces(0, 2); // "A" moves to index 1

      // Active should follow ws1
      expect(get(activeWorkspaceIdx)).toBe(1);
      expect(get(activeWorkspace)?.id).toBe(ws1.id);
    });

    it("handles moving backward", () => {
      const ws1 = makeWorkspace({ name: "A" });
      const ws2 = makeWorkspace({ name: "B" });
      const ws3 = makeWorkspace({ name: "C" });
      workspaces.set([ws1, ws2, ws3]);
      activeWorkspaceIdx.set(2); // "C" is active

      reorderWorkspaces(2, 0);

      const names = get(workspaces).map((w) => w.name);
      expect(names).toEqual(["C", "A", "B"]);
      expect(get(activeWorkspaceIdx)).toBe(0);
    });
  });

  describe("serializeLayout", () => {
    it("serializes a single pane with a terminal surface", () => {
      const s = mockTerminalSurface({ title: "zsh", cwd: "/home" });
      const pane = makePane([s]);
      pane.activeSurfaceId = s.id;
      const node: SplitNode = { type: "pane", pane };

      const result = serializeLayout(node);

      expect(result).toEqual({
        pane: {
          surfaces: [
            { type: "terminal", name: "zsh", cwd: "/home", focus: true },
          ],
        },
      });
    });

    it("serializes an extension surface", () => {
      const ext = mockExtensionSurface({
        title: "Preview",
        surfaceTypeId: "preview:preview",
        props: { filePath: "/tmp/readme.md" },
      });
      const pane: Pane = {
        id: uid(),
        surfaces: [ext],
        activeSurfaceId: ext.id,
      };
      const node: SplitNode = { type: "pane", pane };

      const result = serializeLayout(node);

      expect(result).toEqual({
        pane: {
          surfaces: [
            {
              type: "extension",
              name: "Preview",
              focus: true,
              extensionType: "preview:preview",
              extensionProps: { filePath: "/tmp/readme.md" },
            },
          ],
        },
      });
    });

    it("strips non-serializable props (element, watchId) from extension surfaces", () => {
      const ext = mockExtensionSurface({
        props: {
          filePath: "/tmp/a.md",
          element: document.createElement("div"),
          watchId: 42,
        },
      });
      const pane: Pane = { id: uid(), surfaces: [ext], activeSurfaceId: null };
      const node: SplitNode = { type: "pane", pane };

      const result = serializeLayout(node);
      const surfDef = (
        result as Record<string, unknown> & { pane: { surfaces: unknown[] } }
      ).pane.surfaces[0];

      expect(surfDef.extensionProps).toEqual({ filePath: "/tmp/a.md" });
      expect(surfDef.extensionProps.element).toBeUndefined();
      expect(surfDef.extensionProps.watchId).toBeUndefined();
    });

    it("serializes a split node recursively", () => {
      const s1 = mockTerminalSurface({ title: "left" });
      const s2 = mockTerminalSurface({ title: "right" });
      const pane1 = makePane([s1]);
      const pane2 = makePane([s2]);

      const node: SplitNode = {
        type: "split",
        direction: "horizontal",
        ratio: 0.6,
        children: [
          { type: "pane", pane: pane1 },
          { type: "pane", pane: pane2 },
        ],
      };

      const result = serializeLayout(node);

      expect(result).toMatchObject({
        direction: "horizontal",
        split: 0.6,
        children: [
          { pane: { surfaces: [expect.objectContaining({ name: "left" })] } },
          { pane: { surfaces: [expect.objectContaining({ name: "right" })] } },
        ],
      });
    });

    it("marks only the active surface with focus: true", () => {
      const s1 = mockTerminalSurface({ title: "a" });
      const s2 = mockTerminalSurface({ title: "b" });
      const pane: Pane = {
        id: uid(),
        surfaces: [s1, s2],
        activeSurfaceId: s2.id,
      };
      const node: SplitNode = { type: "pane", pane };

      const result = serializeLayout(node);
      const surfaces = (
        result as Record<string, unknown> & { pane: { surfaces: unknown[] } }
      ).pane.surfaces;

      expect(surfaces[0].focus).toBeUndefined();
      expect(surfaces[1].focus).toBe(true);
    });
  });

  describe("persistWorkspaces", () => {
    it("calls saveState with serialized workspaces", () => {
      const s = mockTerminalSurface({ title: "zsh" });
      const pane = makePane([s]);
      const ws = makeWorkspace({
        name: "My WS",
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      persistWorkspaces();

      expect(saveState).toHaveBeenCalledWith({
        workspaces: [
          {
            id: ws.id,
            name: "My WS",
            cwd: undefined,
            layout: expect.objectContaining({ pane: expect.any(Object) }),
          },
        ],
        activeWorkspaceIdx: 0,
      });
    });
  });

  describe("schedulePersist", () => {
    it("debounces calls to persistWorkspaces", () => {
      const s = mockTerminalSurface();
      const pane = makePane([s]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      schedulePersist();
      schedulePersist();
      schedulePersist();

      // Not called yet — timer hasn't fired
      expect(saveState).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);

      expect(saveState).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================
// pane-service tests
// ============================================================

describe("pane-service", () => {
  describe("focusPane", () => {
    it("updates activePaneId on the workspace", () => {
      const pane1 = makePane();
      const pane2 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            { type: "pane", pane: pane2 },
          ],
        },
        activePaneId: pane1.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      focusPane(pane2.id);

      expect(get(activeWorkspace)?.activePaneId).toBe(pane2.id);
    });

    it("emits pane:focused with previous and new id", () => {
      const pane1 = makePane();
      const pane2 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            { type: "pane", pane: pane2 },
          ],
        },
        activePaneId: pane1.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => focusPane(pane2.id));

      expect(events[0]).toMatchObject({
        type: "pane:focused",
        id: pane2.id,
        previousId: pane1.id,
      });
    });

    it("is a no-op if pane is already focused", () => {
      const pane = makePane();
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => focusPane(pane.id));

      expect(events).toHaveLength(0);
    });
  });

  describe("reorderTab", () => {
    it("moves a surface from one index to another", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const s3 = mockTerminalSurface({ title: "C" });
      const pane = makePane([s1, s2, s3]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      reorderTab(pane.id, 0, 2);

      const titles = pane.surfaces.map((s) => (s as TerminalSurface).title);
      expect(titles).toEqual(["B", "A", "C"]);
    });

    it("is a no-op when fromIdx equals toIdx", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const pane = makePane([s1, s2]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      reorderTab(pane.id, 0, 0);

      const titles = pane.surfaces.map((s) => (s as TerminalSurface).title);
      expect(titles).toEqual(["A", "B"]);
    });

    it("handles moving backward (higher to lower index)", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const s3 = mockTerminalSurface({ title: "C" });
      const pane = makePane([s1, s2, s3]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      reorderTab(pane.id, 2, 0);

      const titles = pane.surfaces.map((s) => (s as TerminalSurface).title);
      expect(titles).toEqual(["C", "A", "B"]);
    });
  });

  describe("focusDirection", () => {
    function makeSplitWorkspace() {
      const pane1 = makePane();
      const pane2 = makePane();
      const pane3 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            {
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                { type: "pane", pane: pane2 },
                { type: "pane", pane: pane3 },
              ],
            },
          ],
        },
        activePaneId: pane1.id,
      });
      return { ws, pane1, pane2, pane3 };
    }

    it("moves focus to the next pane on right/down", () => {
      const { ws, pane2 } = makeSplitWorkspace();
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      focusDirection("right");

      expect(get(activeWorkspace)?.activePaneId).toBe(pane2.id);
    });

    it("moves focus to the previous pane on left/up", () => {
      const { ws, pane1, pane2 } = makeSplitWorkspace();
      ws.activePaneId = pane2.id;
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      focusDirection("left");

      expect(get(activeWorkspace)?.activePaneId).toBe(pane1.id);
    });

    it("wraps around from last to first pane", () => {
      const { ws, pane1, pane3 } = makeSplitWorkspace();
      ws.activePaneId = pane3.id;
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      focusDirection("right");

      expect(get(activeWorkspace)?.activePaneId).toBe(pane1.id);
    });

    it("wraps around from first to last pane", () => {
      const { ws, pane1, pane3 } = makeSplitWorkspace();
      ws.activePaneId = pane1.id;
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      focusDirection("up");

      expect(get(activeWorkspace)?.activePaneId).toBe(pane3.id);
    });

    it("is a no-op with only one pane", () => {
      const pane = makePane();
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      focusDirection("right");

      expect(get(activeWorkspace)?.activePaneId).toBe(pane.id);
    });
  });

  describe("removePane", () => {
    it("promotes sibling when removing one pane from a split", () => {
      const pane1 = makePane();
      const pane2 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            { type: "pane", pane: pane2 },
          ],
        },
        activePaneId: pane1.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      removePane(ws, pane1);

      const updated = get(activeWorkspace);
      expect(updated?.splitRoot.type).toBe("pane");
      expect((updated?.splitRoot as { type: "pane"; pane: Pane }).pane.id).toBe(
        pane2.id,
      );
    });

    it("emits pane:closed", () => {
      const pane1 = makePane();
      const pane2 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            { type: "pane", pane: pane2 },
          ],
        },
        activePaneId: pane1.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => removePane(ws, pane1));

      expect(events).toContainEqual(
        expect.objectContaining({ type: "pane:closed", id: pane1.id }),
      );
    });

    it("removes the workspace when removing the root pane (and creates a new one)", () => {
      const pane = makePane();
      const ws1 = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      const ws2 = makeWorkspace({ name: "WS2" });
      workspaces.set([ws1, ws2]);
      activeWorkspaceIdx.set(0);

      removePane(ws1, pane);

      // ws1 should have been removed
      const list = get(workspaces);
      expect(list.find((w) => w.id === ws1.id)).toBeUndefined();
    });

    it("disconnects resize observer on the removed pane", () => {
      const disconnect = vi.fn();
      const pane1 = makePane();
      pane1.resizeObserver = { disconnect } as unknown as ResizeObserver;
      const pane2 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            { type: "pane", pane: pane2 },
          ],
        },
        activePaneId: pane1.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      removePane(ws, pane1);

      expect(disconnect).toHaveBeenCalled();
    });
  });
});

// ============================================================
// surface-service tests
// ============================================================

describe("surface-service", () => {
  describe("selectSurface", () => {
    it("sets activeSurfaceId on the pane", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      selectSurface(pane.id, s2.id);

      expect(pane.activeSurfaceId).toBe(s2.id);
    });

    it("clears hasUnread on the selected surface", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B", hasUnread: true });
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      selectSurface(pane.id, s2.id);

      expect(s2.hasUnread).toBe(false);
    });

    it("emits surface:activated", () => {
      const s1 = mockTerminalSurface();
      const s2 = mockTerminalSurface();
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => selectSurface(pane.id, s2.id));

      expect(events[0]).toMatchObject({
        type: "surface:activated",
        id: s2.id,
        paneId: pane.id,
      });
    });
  });

  describe("nextSurface", () => {
    it("cycles to the next surface", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const s3 = mockTerminalSurface({ title: "C" });
      const pane = makePane([s1, s2, s3]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      nextSurface();

      expect(pane.activeSurfaceId).toBe(s2.id);
    });

    it("wraps from last to first", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s2.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      nextSurface();

      expect(pane.activeSurfaceId).toBe(s1.id);
    });

    it("is a no-op with only one surface", () => {
      const s = mockTerminalSurface();
      const pane = makePane([s]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      nextSurface();

      expect(pane.activeSurfaceId).toBe(s.id);
    });
  });

  describe("prevSurface", () => {
    it("cycles to the previous surface", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const s3 = mockTerminalSurface({ title: "C" });
      const pane = makePane([s1, s2, s3]);
      pane.activeSurfaceId = s2.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      prevSurface();

      expect(pane.activeSurfaceId).toBe(s1.id);
    });

    it("wraps from first to last", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      prevSurface();

      expect(pane.activeSurfaceId).toBe(s2.id);
    });
  });

  describe("selectSurfaceByNumber", () => {
    it("selects the surface at 1-indexed position", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const s3 = mockTerminalSurface({ title: "C" });
      const pane = makePane([s1, s2, s3]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      selectSurfaceByNumber(2);

      expect(pane.activeSurfaceId).toBe(s2.id);
    });

    it("selects the last surface when number is 9", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const s3 = mockTerminalSurface({ title: "C" });
      const pane = makePane([s1, s2, s3]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      selectSurfaceByNumber(9);

      expect(pane.activeSurfaceId).toBe(s3.id);
    });

    it("is a no-op for out-of-range number", () => {
      const s1 = mockTerminalSurface();
      const pane = makePane([s1]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      selectSurfaceByNumber(5);

      expect(pane.activeSurfaceId).toBe(s1.id);
    });
  });

  describe("closeActiveSurface", () => {
    it("removes the active surface from the pane", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      closeActiveSurface();

      expect(pane.surfaces).toHaveLength(1);
      expect(pane.surfaces[0].id).toBe(s2.id);
    });

    it("disposes terminal and kills PTY on close", () => {
      const s1 = mockTerminalSurface({ ptyId: 7 });
      const s2 = mockTerminalSurface();
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      closeActiveSurface();

      expect(s1.terminal.dispose).toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("kill_pty", { ptyId: 7 });
    });

    it("activates the next surface after closing", () => {
      const s1 = mockTerminalSurface({ title: "A" });
      const s2 = mockTerminalSurface({ title: "B" });
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      closeActiveSurface();

      expect(pane.activeSurfaceId).toBe(s2.id);
    });

    it("emits surface:closed", () => {
      const s1 = mockTerminalSurface();
      const s2 = mockTerminalSurface();
      const pane = makePane([s1, s2]);
      pane.activeSurfaceId = s1.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      const events = collectEvents(() => closeActiveSurface());

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "surface:closed",
          id: s1.id,
          paneId: pane.id,
        }),
      );
    });

    it("removes the pane when closing the last surface", () => {
      const s = mockTerminalSurface();
      const pane1 = makePane([s]);
      pane1.activeSurfaceId = s.id;
      const pane2 = makePane();
      const ws = makeWorkspace({
        splitRoot: {
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { type: "pane", pane: pane1 },
            { type: "pane", pane: pane2 },
          ],
        },
        activePaneId: pane1.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      closeActiveSurface();

      // pane1 had its last surface removed, so the pane should be gone
      // and pane2 should be promoted to root
      const updated = get(activeWorkspace);
      expect(updated?.splitRoot.type).toBe("pane");
      expect((updated?.splitRoot as { type: "pane"; pane: Pane }).pane.id).toBe(
        pane2.id,
      );
    });

    it("closes the workspace when the last surface of the only pane is closed", () => {
      const s = mockTerminalSurface();
      const pane = makePane([s]);
      pane.activeSurfaceId = s.id;
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      const other = makeWorkspace({ id: "ws-other" });
      workspaces.set([ws, other]);
      activeWorkspaceIdx.set(0);

      closeActiveSurface();

      const list = get(workspaces);
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe("ws-other");
    });
  });

  describe("openExtensionSurfaceInPane", () => {
    it("adds an extension surface to the active pane", () => {
      const s = mockTerminalSurface();
      const pane = makePane([s]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      openExtensionSurfaceInPane("preview:preview", "README", {
        filePath: "/tmp/readme.md",
      });

      expect(pane.surfaces).toHaveLength(2);
      const ext = pane.surfaces[1];
      expect(ext.kind).toBe("extension");
      expect((ext as ExtensionSurface).surfaceTypeId).toBe("preview:preview");
      expect((ext as ExtensionSurface).title).toBe("README");
      expect((ext as ExtensionSurface).props).toEqual({
        filePath: "/tmp/readme.md",
      });
    });

    it("sets the new extension surface as active", () => {
      const s = mockTerminalSurface();
      const pane = makePane([s]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      openExtensionSurfaceInPane("test:panel", "Test Panel");

      expect(pane.activeSurfaceId).toBe(pane.surfaces[1].id);
    });

    it("defaults props to empty object when not provided", () => {
      const s = mockTerminalSurface();
      const pane = makePane([s]);
      const ws = makeWorkspace({
        splitRoot: { type: "pane", pane },
        activePaneId: pane.id,
      });
      workspaces.set([ws]);
      activeWorkspaceIdx.set(0);

      openExtensionSurfaceInPane("test:panel", "Test Panel");

      expect((pane.surfaces[1] as ExtensionSurface).props).toEqual({});
    });
  });
});
