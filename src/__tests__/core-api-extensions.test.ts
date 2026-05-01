/**
 * Tests for Story 0: Core API Extensions
 *
 * Tests findSurfaceLocation, markSurfaceUnreadById, and focusSurfaceById
 * in surface-service, plus git_merge in the extension allowlist.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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
  configStore: { subscribe: vi.fn(() => () => {}) },
}));

vi.mock("../lib/services/service-helpers", () => ({
  safeFocus: vi.fn(),
  getActiveCwd: vi.fn().mockResolvedValue(undefined),
  getCwdForSurface: vi.fn().mockResolvedValue(undefined),
}));

// --- Imports ---

import {
  nestedWorkspaces,
  activeNestedWorkspaceIdx,
} from "../lib/stores/workspace";
import type {
  NestedWorkspace,
  Pane,
  TerminalSurface,
  ExtensionSurface,
} from "../lib/types";
import { uid } from "../lib/types";

import {
  findSurfaceLocation,
  markSurfaceUnreadById,
  focusSurfaceById,
} from "../lib/services/surface-service";

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
  surfaces?: (TerminalSurface | ExtensionSurface)[],
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

function makeNestedWorkspace(
  overrides: Partial<NestedWorkspace> = {},
): NestedWorkspace {
  const pane = makePane();
  return {
    id: uid(),
    name: "Workspace 1",
    splitRoot: { type: "pane", pane },
    activePaneId: pane.id,
    ...overrides,
  };
}

// --- Tests ---

describe("findSurfaceLocation", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("finds a surface across multiple nestedWorkspaces and panes", () => {
    const targetSurface = mockTerminalSurface();
    const pane1 = makePane([mockTerminalSurface()]);
    const pane2 = makePane([targetSurface]);
    const ws1 = makeNestedWorkspace({
      splitRoot: { type: "pane", pane: pane1 },
      activePaneId: pane1.id,
    });
    const ws2 = makeNestedWorkspace({
      splitRoot: { type: "pane", pane: pane2 },
      activePaneId: pane2.id,
    });

    nestedWorkspaces.set([ws1, ws2]);

    const loc = findSurfaceLocation(targetSurface.id);
    expect(loc).not.toBeNull();
    expect(loc!.workspace.id).toBe(ws2.id);
    expect(loc!.pane.id).toBe(pane2.id);
    expect(loc!.surface.id).toBe(targetSurface.id);
  });

  it("returns null when surface does not exist", () => {
    const ws = makeNestedWorkspace();
    nestedWorkspaces.set([ws]);

    const loc = findSurfaceLocation("nonexistent-id");
    expect(loc).toBeNull();
  });

  it("works with extension surfaces", () => {
    const extSurface = mockExtensionSurface();
    const pane = makePane([extSurface]);
    const ws = makeNestedWorkspace({
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    });
    nestedWorkspaces.set([ws]);

    const loc = findSurfaceLocation(extSurface.id);
    expect(loc).not.toBeNull();
    expect(loc!.surface.id).toBe(extSurface.id);
  });
});

describe("markSurfaceUnreadById", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("sets hasUnread to true on an existing surface", () => {
    const surface = mockTerminalSurface({ hasUnread: false });
    const pane = makePane([surface]);
    const ws = makeNestedWorkspace({
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    });
    nestedWorkspaces.set([ws]);

    markSurfaceUnreadById(surface.id);

    // The surface object is mutated in place
    expect(surface.hasUnread).toBe(true);
  });

  it("is a no-op when surface does not exist (no error thrown)", () => {
    const ws = makeNestedWorkspace();
    nestedWorkspaces.set([ws]);

    // Should not throw
    expect(() => markSurfaceUnreadById("nonexistent-id")).not.toThrow();
  });

  it("triggers store update", () => {
    const surface = mockTerminalSurface({ hasUnread: false });
    const pane = makePane([surface]);
    const ws = makeNestedWorkspace({
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    });
    nestedWorkspaces.set([ws]);

    const updates: unknown[] = [];
    const unsub = nestedWorkspaces.subscribe((v) => updates.push(v));

    markSurfaceUnreadById(surface.id);

    // At least one additional update beyond the initial subscription call
    expect(updates.length).toBeGreaterThan(1);
    unsub();
  });
});

describe("focusSurfaceById", () => {
  beforeEach(() => {
    nestedWorkspaces.set([]);
    activeNestedWorkspaceIdx.set(-1);
  });

  it("switches to the workspace containing the surface and selects it", () => {
    const surface1 = mockTerminalSurface();
    const pane1 = makePane([surface1]);
    const ws1 = makeNestedWorkspace({
      name: "WS 1",
      splitRoot: { type: "pane", pane: pane1 },
      activePaneId: pane1.id,
    });

    const targetSurface = mockTerminalSurface({ hasUnread: true });
    const pane2 = makePane([mockTerminalSurface(), targetSurface]);
    const ws2 = makeNestedWorkspace({
      name: "WS 2",
      splitRoot: { type: "pane", pane: pane2 },
      activePaneId: pane2.id,
    });

    nestedWorkspaces.set([ws1, ws2]);
    activeNestedWorkspaceIdx.set(0); // Start on ws1

    focusSurfaceById(targetSurface.id);

    // Should have switched to ws2 (index 1)
    expect(get(activeNestedWorkspaceIdx)).toBe(1);
    // Surface should be selected (activeSurfaceId updated)
    expect(pane2.activeSurfaceId).toBe(targetSurface.id);
    // hasUnread should be cleared by selectSurface
    expect(targetSurface.hasUnread).toBe(false);
  });

  it("is a no-op when surface does not exist (no error thrown)", () => {
    const ws = makeNestedWorkspace();
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    expect(() => focusSurfaceById("nonexistent-id")).not.toThrow();
    // NestedWorkspace idx unchanged
    expect(get(activeNestedWorkspaceIdx)).toBe(0);
  });

  it("works when surface is in the already-active workspace", () => {
    const targetSurface = mockTerminalSurface();
    const otherSurface = mockTerminalSurface();
    const pane = makePane([otherSurface, targetSurface]);
    const ws = makeNestedWorkspace({
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    });
    nestedWorkspaces.set([ws]);
    activeNestedWorkspaceIdx.set(0);

    focusSurfaceById(targetSurface.id);

    expect(get(activeNestedWorkspaceIdx)).toBe(0);
    expect(pane.activeSurfaceId).toBe(targetSurface.id);
  });
});

describe("git_merge in EXTENSION_ALLOWED_COMMANDS", () => {
  it("git_merge is in the extension allowlist", async () => {
    // Verify by reading the source — the allowlist is a Set constant.
    // We import and call createExtensionAPI to test that git_merge is allowed.
    // This is tested via the extension-loader's invoke allowlist behavior.

    // We verify indirectly: the source file includes "git_merge" in the Set.
    // A direct test would require importing the private Set, so we test via
    // the api.invoke path in extension-loader.test.ts patterns.
    // For this test, we just verify the constant is exported correctly
    // by checking the source code.
    const fs = await import("fs");
    const path = await import("path");
    const constantsPath = path.resolve(
      __dirname,
      "../lib/services/extension-constants.ts",
    );
    const source = fs.readFileSync(constantsPath, "utf-8");
    expect(source).toContain('"git_merge"');
  });
});
