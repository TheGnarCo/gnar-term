/**
 * Keyboard shortcut dispatch tests.
 *
 * Covers the bindings that are not registered through the command palette —
 * the hardcoded branches in handleAppKeydown that reference component refs
 * or stores. Mocks `isMac` via module mocking so we can exercise both
 * platforms.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

const terminalClear = vi.fn();
const isTerminalSurfaceMock = vi.fn().mockReturnValue(true);

vi.mock("../lib/types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/types")>();
  return {
    ...actual,
    isTerminalSurface: (...args: unknown[]) => isTerminalSurfaceMock(...args),
  };
});

// Mock terminal-service so we can flip isMac per test suite.
let mockIsMac = false;
const adjustFontSizeMock = vi.fn();
vi.mock("../lib/terminal-service", () => ({
  get isMac() {
    return mockIsMac;
  },
  adjustFontSize: (...args: unknown[]) => adjustFontSizeMock(...args),
}));

// Services — stubbed so keydown dispatch doesn't trigger real side effects.
vi.mock("../lib/services/workspace-runtime-service", () => ({
  createWorkspaceFromDef: vi.fn(),
}));
vi.mock("../lib/services/pane-service", () => ({
  flashFocusedPane: vi.fn(),
  focusDirection: vi.fn(),
}));
const renameActiveSurfaceMock = vi.fn();
vi.mock("../lib/services/surface-service", () => ({
  newSurfaceFromSidebar: vi.fn(),
  nextSurface: vi.fn(),
  prevSurface: vi.fn(),
  selectSurfaceByNumber: vi.fn(),
  renameActiveSurface: (...args: unknown[]) => renameActiveSurfaceMock(...args),
}));
vi.mock("../lib/services/command-registry", () => ({
  executeByShortcut: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/services/workspace-action-registry", () => ({
  executeWorkspaceActionByShortcut: vi.fn().mockReturnValue(false),
}));

const activateWorkspaceMock = vi.fn();
vi.mock("../lib/services/workspace-service", () => ({
  activateWorkspace: (...args: unknown[]) => activateWorkspaceMock(...args),
}));

async function loadModule() {
  const ui = await import("../lib/stores/ui");
  const workspace = await import("../lib/stores/workspace");
  const shortcuts = await import("../lib/services/keyboard-shortcuts");
  return { ui, workspace, shortcuts };
}

const ctx = {
  startRenameActiveWorkspace: vi.fn(),
  findNext: vi.fn(),
  findPrev: vi.fn(),
};

function mkEvent(opts: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): KeyboardEvent {
  return {
    key: opts.key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    altKey: !!opts.alt,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe("keyboard-shortcuts — clear + find bindings", () => {
  beforeEach(async () => {
    terminalClear.mockClear();
    isTerminalSurfaceMock.mockReturnValue(true);
    const { workspace } = await loadModule();
    // Seed activeSurface with a fake terminal surface.
    workspace.workspaces.set([
      {
        id: "ws",
        name: "ws",
        paneLayout: {
          type: "pane",
          pane: {
            id: "p",
            surfaces: [
              {
                id: "s",
                type: "terminal",
                title: "t",
                terminal: { clear: terminalClear } as never,
              } as never,
            ],
            activeSurfaceId: "s",
          },
        },
        activePaneId: "p",
      } as never,
    ]);
    workspace.activeWorkspaceIdx.set(0);
  });

  describe("macOS platform", () => {
    beforeEach(() => {
      mockIsMac = true;
    });

    it("⌘K clears the focused terminal", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(mkEvent({ key: "k", meta: true }), ctx);
      expect(terminalClear).toHaveBeenCalledOnce();
    });

    it("⌘F toggles findBarVisible", async () => {
      const { ui, shortcuts } = await loadModule();
      ui.findBarVisible.set(false);
      shortcuts.handleAppKeydown(mkEvent({ key: "f", meta: true }), ctx);
      expect(get(ui.findBarVisible)).toBe(true);
    });

    it("⌘R calls renameActiveSurface", async () => {
      const { shortcuts } = await loadModule();
      renameActiveSurfaceMock.mockClear();
      shortcuts.handleAppKeydown(mkEvent({ key: "r", meta: true }), ctx);
      expect(renameActiveSurfaceMock).toHaveBeenCalledOnce();
    });

    it("Ctrl+Shift+K does NOT clear on macOS (mac uses bare ⌘K)", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(
        mkEvent({ key: "k", ctrl: true, shift: true }),
        ctx,
      );
      expect(terminalClear).not.toHaveBeenCalled();
    });
  });

  describe("Linux/Windows platform", () => {
    beforeEach(() => {
      mockIsMac = false;
    });

    it("Ctrl+Shift+K clears the focused terminal", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(
        mkEvent({ key: "K", ctrl: true, shift: true }),
        ctx,
      );
      expect(terminalClear).toHaveBeenCalledOnce();
    });

    it("Ctrl+Shift+F toggles findBarVisible", async () => {
      const { ui, shortcuts } = await loadModule();
      ui.findBarVisible.set(false);
      shortcuts.handleAppKeydown(
        mkEvent({ key: "F", ctrl: true, shift: true }),
        ctx,
      );
      expect(get(ui.findBarVisible)).toBe(true);
    });

    it("bare ⌘K (metaKey) does NOT clear on non-Mac", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(mkEvent({ key: "k", meta: true }), ctx);
      expect(terminalClear).not.toHaveBeenCalled();
    });
  });
});

describe("keyboard-shortcuts — font zoom bindings", () => {
  beforeEach(() => {
    adjustFontSizeMock.mockReset();
  });

  describe("macOS", () => {
    beforeEach(() => {
      mockIsMac = true;
    });

    it("⌘= zooms in", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(mkEvent({ key: "=", meta: true }), ctx);
      expect(adjustFontSizeMock).toHaveBeenCalledWith(1);
    });

    it("⌘+ zooms in", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(mkEvent({ key: "+", meta: true }), ctx);
      expect(adjustFontSizeMock).toHaveBeenCalledWith(1);
    });

    it("⌘- zooms out", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(mkEvent({ key: "-", meta: true }), ctx);
      expect(adjustFontSizeMock).toHaveBeenCalledWith(-1);
    });
  });

  describe("non-Mac", () => {
    beforeEach(() => {
      mockIsMac = false;
    });

    it("Ctrl+Shift+= zooms in", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(
        mkEvent({ key: "+", ctrl: true, shift: true }),
        ctx,
      );
      expect(adjustFontSizeMock).toHaveBeenCalledWith(1);
    });

    it("Ctrl+Shift+- zooms out", async () => {
      const { shortcuts } = await loadModule();
      shortcuts.handleAppKeydown(
        mkEvent({ key: "_", ctrl: true, shift: true }),
        ctx,
      );
      expect(adjustFontSizeMock).toHaveBeenCalledWith(-1);
    });
  });
});

describe("keyboard-shortcuts — ⌘1-9 workspace activation", () => {
  function makeWs(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      name: id,
      paneLayout: {
        type: "pane",
        pane: { id: `${id}-p`, surfaces: [], activeSurfaceId: null },
      },
      activePaneId: `${id}-p`,
      ...extra,
    } as never;
  }

  beforeEach(async () => {
    mockIsMac = true;
    activateWorkspaceMock.mockReset();
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    rootRowOrder.set([]);
    workspace.workspaces.set([]);
  });

  it("activates the nth workspace-kind row, skipping non-workspace rows", async () => {
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    workspace.workspaces.set([makeWs("ws-A"), makeWs("ws-B")]);
    rootRowOrder.set([
      { kind: "pseudo-workspace", id: "nw-1" },
      { kind: "workspace", id: "ws-A" },
      { kind: "pseudo-workspace", id: "nw-2" },
      { kind: "workspace", id: "ws-B" },
    ]);
    const { shortcuts } = await loadModule();
    // ⌘1 → first workspace-kind row = ws-A
    shortcuts.handleAppKeydown(mkEvent({ key: "1", meta: true }), ctx);
    expect(activateWorkspaceMock).toHaveBeenCalledWith("ws-A");
  });

  it("activates the second workspace-kind row with ⌘2", async () => {
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    workspace.workspaces.set([makeWs("ws-A"), makeWs("ws-B"), makeWs("ws-C")]);
    rootRowOrder.set([
      { kind: "workspace", id: "ws-A" },
      { kind: "pseudo-workspace", id: "nw-1" },
      { kind: "workspace", id: "ws-B" },
      { kind: "workspace", id: "ws-C" },
    ]);
    const { shortcuts } = await loadModule();
    shortcuts.handleAppKeydown(mkEvent({ key: "2", meta: true }), ctx);
    expect(activateWorkspaceMock).toHaveBeenCalledWith("ws-B");
  });

  it("does nothing when ⌘N has no workspace at that position", async () => {
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    workspace.workspaces.set([makeWs("ws-only")]);
    rootRowOrder.set([{ kind: "workspace", id: "ws-only" }]);
    const { shortcuts } = await loadModule();
    // ⌘5 — only one workspace exists
    shortcuts.handleAppKeydown(mkEvent({ key: "5", meta: true }), ctx);
    expect(activateWorkspaceMock).not.toHaveBeenCalled();
  });

  it("ignores non-workspace rows when counting positions", async () => {
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    workspace.workspaces.set([makeWs("ws-A"), makeWs("ws-B")]);
    // 9 rows but only 2 are workspace-kind
    rootRowOrder.set([
      { kind: "pseudo-workspace", id: "nw-1" },
      { kind: "pseudo-workspace", id: "nw-2" },
      { kind: "pseudo-workspace", id: "nw-3" },
      { kind: "workspace", id: "ws-A" },
      { kind: "pseudo-workspace", id: "nw-4" },
      { kind: "workspace", id: "ws-B" },
      { kind: "pseudo-workspace", id: "nw-5" },
    ]);
    const { shortcuts } = await loadModule();
    shortcuts.handleAppKeydown(mkEvent({ key: "1", meta: true }), ctx);
    expect(activateWorkspaceMock).toHaveBeenCalledWith("ws-A");
    activateWorkspaceMock.mockReset();
    shortcuts.handleAppKeydown(mkEvent({ key: "2", meta: true }), ctx);
    expect(activateWorkspaceMock).toHaveBeenCalledWith("ws-B");
    activateWorkspaceMock.mockReset();
    shortcuts.handleAppKeydown(mkEvent({ key: "3", meta: true }), ctx);
    expect(activateWorkspaceMock).not.toHaveBeenCalled();
  });

  it("skips standalone Dashboard Workspace chips when counting ⌘N positions", async () => {
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    workspace.workspaces.set([
      makeWs("ws-A"),
      makeWs("settings-1", {
        isDashboard: true,
        dashboardContributionId: "gnar-term:settings",
      }),
      makeWs("ws-B"),
    ]);
    rootRowOrder.set([
      { kind: "workspace", id: "ws-A" },
      { kind: "workspace", id: "settings-1" },
      { kind: "workspace", id: "ws-B" },
    ]);
    const { shortcuts } = await loadModule();
    // ⌘1 → ws-A (first core banner)
    shortcuts.handleAppKeydown(mkEvent({ key: "1", meta: true }), ctx);
    expect(activateWorkspaceMock).toHaveBeenCalledWith("ws-A");
    activateWorkspaceMock.mockReset();
    // ⌘2 → ws-B (dashboard chip is skipped, NOT settings-1)
    shortcuts.handleAppKeydown(mkEvent({ key: "2", meta: true }), ctx);
    expect(activateWorkspaceMock).toHaveBeenCalledWith("ws-B");
    activateWorkspaceMock.mockReset();
    // ⌘3 → no third core banner
    shortcuts.handleAppKeydown(mkEvent({ key: "3", meta: true }), ctx);
    expect(activateWorkspaceMock).not.toHaveBeenCalled();
  });

  it("does not activate workspaces via Ctrl+N on non-Mac (⌘-only feature)", async () => {
    mockIsMac = false;
    const { rootRowOrder } = await import("../lib/stores/root-row-order");
    const { workspace } = await loadModule();
    workspace.workspaces.set([makeWs("ws-linux")]);
    rootRowOrder.set([{ kind: "workspace", id: "ws-linux" }]);
    const { shortcuts } = await loadModule();
    shortcuts.handleAppKeydown(mkEvent({ key: "1", ctrl: true }), ctx);
    expect(activateWorkspaceMock).not.toHaveBeenCalled();
  });
});
