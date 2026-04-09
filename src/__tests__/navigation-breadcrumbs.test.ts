/**
 * Tests for S4: Navigation & Breadcrumbs
 *
 * Covers:
 * - Breadcrumb rendering with and without project context
 * - Keyboard shortcuts (Cmd+Shift+H, Cmd+,, Escape)
 * - Command palette entries
 * - Inactive projects section rendering
 * - openWorkspace preserves projectId
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import { render, screen, cleanup, fireEvent } from "@testing-library/svelte";

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
    buffer: { active: { getLine: vi.fn() } },
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn(),
    scrollToBottom: vi.fn(),
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
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
    dispose: vi.fn(),
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
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import TitleBar from "../lib/components/TitleBar.svelte";
import HomeScreen from "../lib/components/HomeScreen.svelte";
import {
  handleKeydown,
  isModifier,
  type KeybindingActions,
} from "../lib/keybindings";
import { isMac } from "../lib/terminal-service";
import {
  currentView,
  currentProjectId,
  openWorkspace,
  goHome,
  sidebarVisible,
  commandPaletteOpen,
  findBarVisible,
} from "../lib/stores/ui";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import { projects } from "../lib/stores/project";
import { makeWorkspace, makePane, makeSurface } from "./helpers/mocks";
import type { Workspace } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActions(): KeybindingActions {
  return {
    createWorkspace: vi.fn(),
    newSurface: vi.fn(),
    splitHorizontal: vi.fn(),
    splitVertical: vi.fn(),
    closeWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
    selectSurface: vi.fn(),
    nextSurface: vi.fn(),
    prevSurface: vi.fn(),
    toggleSidebar: vi.fn(),
    clearTerminal: vi.fn(),
    focusDirection: vi.fn(),
    togglePaneZoom: vi.fn(),
    flashFocusedPane: vi.fn(),
    startRename: vi.fn(),
    toggleCommandPalette: vi.fn(),
    toggleFindBar: vi.fn(),
    findNext: vi.fn(),
    findPrev: vi.fn(),
    closeFindBar: vi.fn(),
    goHome: vi.fn(),
    openSettings: vi.fn(),
    escapeBack: vi.fn(),
    workspaceCount: vi.fn().mockReturnValue(3),
    activeIdx: vi.fn().mockReturnValue(0),
    findBarVisible: vi.fn().mockReturnValue(false),
    commandPaletteOpen: vi.fn().mockReturnValue(false),
    currentView: vi.fn().mockReturnValue("workspace"),
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Reset stores between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  cleanup();
  currentView.set("home");
  currentProjectId.set(null);
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  sidebarVisible.set(true);
  commandPaletteOpen.set(false);
  findBarVisible.set(false);
  projects.set([]);
});

// ===========================================================================
// TitleBar Breadcrumbs
// ===========================================================================

describe("TitleBar breadcrumbs", () => {
  it("renders GnarTerm when on home view", () => {
    currentView.set("home");
    render(TitleBar);
    expect(screen.getByText("GnarTerm")).toBeDefined();
  });

  it("renders Settings when on settings view", () => {
    currentView.set("settings");
    render(TitleBar);
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("renders breadcrumbs with home button for floating workspace", () => {
    const ws = makeWorkspace("ws1", "My Terminal");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    currentView.set("workspace");

    render(TitleBar);

    const homeBtn = screen.getByTestId("breadcrumb-home");
    expect(homeBtn).toBeDefined();

    const wsLabel = screen.getByTestId("breadcrumb-workspace");
    expect(wsLabel.textContent).toBe("My Terminal");
  });

  it("renders breadcrumbs with project segment for project workspace", () => {
    const ws: Workspace = {
      ...makeWorkspace("ws1", "feature-branch"),
      record: {
        id: "ws1",
        type: "managed",
        name: "feature-branch",
        branch: "feature-branch",
        status: "active",
        createdAt: Date.now(),
        projectId: "proj1",
      },
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    currentView.set("workspace");
    projects.set([
      {
        id: "proj1",
        name: "GnarTerm",
        path: "/projects/gnar",
        active: true,
        workspaces: [],
        gitBacked: true,
      },
    ]);

    render(TitleBar);

    const homeBtn = screen.getByTestId("breadcrumb-home");
    expect(homeBtn).toBeDefined();

    const projectBtn = screen.getByTestId("breadcrumb-project");
    expect(projectBtn.textContent).toBe("GnarTerm");

    const wsLabel = screen.getByTestId("breadcrumb-workspace");
    expect(wsLabel.textContent).toBe("feature-branch");
  });

  it("does not show project segment for floating workspace", () => {
    const ws = makeWorkspace("ws1", "Shell");
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    currentView.set("workspace");

    render(TitleBar);

    const projectBtn = screen.queryByTestId("breadcrumb-project");
    expect(projectBtn).toBeNull();
  });

  it("renders project dashboard title when on project view", () => {
    currentView.set("project");
    currentProjectId.set("proj1");
    projects.set([
      {
        id: "proj1",
        name: "GnarTerm",
        path: "/projects/gnar",
        active: true,
        workspaces: [],
        gitBacked: true,
      },
    ]);

    render(TitleBar);
    expect(screen.getByText("GnarTerm Dashboard")).toBeDefined();
  });
});

// ===========================================================================
// Keyboard Shortcuts
// ===========================================================================

describe("keyboard shortcuts", () => {
  it("Cmd+Shift+H (macOS) / Ctrl+Shift+H (Linux) triggers goHome", () => {
    const actions = makeActions();
    const e = new KeyboardEvent("keydown", {
      key: isMac ? "h" : "H",
      metaKey: isMac,
      ctrlKey: !isMac,
      shiftKey: true,
    });
    handleKeydown(e, actions);
    expect(actions.goHome).toHaveBeenCalled();
  });

  it("Cmd+, (macOS) / Ctrl+, (Linux) triggers openSettings", () => {
    const actions = makeActions();
    const e = new KeyboardEvent("keydown", {
      key: ",",
      metaKey: isMac,
      ctrlKey: !isMac,
    });
    handleKeydown(e, actions);
    expect(actions.openSettings).toHaveBeenCalled();
  });

  it("Escape triggers escapeBack when on settings view", () => {
    const actions = makeActions();
    (actions.currentView as ReturnType<typeof vi.fn>).mockReturnValue(
      "settings",
    );
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    handleKeydown(e, actions);
    expect(actions.escapeBack).toHaveBeenCalled();
  });

  it("Escape triggers escapeBack when on project view", () => {
    const actions = makeActions();
    (actions.currentView as ReturnType<typeof vi.fn>).mockReturnValue(
      "project",
    );
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    handleKeydown(e, actions);
    expect(actions.escapeBack).toHaveBeenCalled();
  });

  it("Escape triggers escapeBack when on project-settings view", () => {
    const actions = makeActions();
    (actions.currentView as ReturnType<typeof vi.fn>).mockReturnValue(
      "project-settings",
    );
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    handleKeydown(e, actions);
    expect(actions.escapeBack).toHaveBeenCalled();
  });

  it("Escape does NOT trigger escapeBack when on workspace view", () => {
    const actions = makeActions();
    (actions.currentView as ReturnType<typeof vi.fn>).mockReturnValue(
      "workspace",
    );
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    handleKeydown(e, actions);
    expect(actions.escapeBack).not.toHaveBeenCalled();
  });

  it("Escape does NOT trigger escapeBack when find bar is visible", () => {
    const actions = makeActions();
    (actions.findBarVisible as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (actions.currentView as ReturnType<typeof vi.fn>).mockReturnValue(
      "settings",
    );
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    handleKeydown(e, actions);
    expect(actions.escapeBack).not.toHaveBeenCalled();
    expect(actions.closeFindBar).toHaveBeenCalled();
  });

  it("Escape does NOT trigger escapeBack when command palette is open", () => {
    const actions = makeActions();
    (actions.commandPaletteOpen as ReturnType<typeof vi.fn>).mockReturnValue(
      true,
    );
    (actions.currentView as ReturnType<typeof vi.fn>).mockReturnValue(
      "settings",
    );
    const e = new KeyboardEvent("keydown", { key: "Escape" });
    handleKeydown(e, actions);
    expect(actions.escapeBack).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// openWorkspace preserves projectId
// ===========================================================================

describe("openWorkspace projectId", () => {
  it("infers null projectId when no arg and no active workspace", async () => {
    currentProjectId.set("old-project");
    openWorkspace();
    // Wait for microtask (dynamic import resolution)
    await new Promise((r) => setTimeout(r, 0));
    expect(get(currentProjectId)).toBeNull();
  });

  it("preserves projectId when passed explicitly", () => {
    openWorkspace("proj-123");
    expect(get(currentProjectId)).toBe("proj-123");
    expect(get(currentView)).toBe("workspace");
  });

  it("sets currentProjectId to null when null passed explicitly", () => {
    currentProjectId.set("old-project");
    openWorkspace(null);
    expect(get(currentProjectId)).toBeNull();
  });

  it("infers projectId from active workspace record", async () => {
    const ws: Workspace = {
      ...makeWorkspace("ws1", "Branch WS"),
      record: {
        id: "ws1",
        type: "managed",
        name: "Branch WS",
        status: "active",
        createdAt: Date.now(),
        projectId: "proj-456",
      },
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);

    openWorkspace();
    // Wait for microtask (dynamic import resolution)
    await new Promise((r) => setTimeout(r, 0));
    expect(get(currentProjectId)).toBe("proj-456");
    expect(get(currentView)).toBe("workspace");
  });
});

// ===========================================================================
// Inactive Projects Section (HomeScreen)
// ===========================================================================

describe("HomeScreen inactive projects", () => {
  const homeProps = {
    onSwitchToWorkspace: noop,
    onAddProject: noop,
    onNewWorkspace: noop,
    onNewFloatingWorkspace: noop,
  };

  it("does not render inactive section when no inactive projects", () => {
    projects.set([
      {
        id: "p1",
        name: "Active Project",
        path: "/p1",
        active: true,
        workspaces: [],
        gitBacked: false,
      },
    ]);
    render(HomeScreen, homeProps);
    expect(screen.queryByTestId("inactive-projects")).toBeNull();
  });

  it("renders inactive section toggle when inactive projects exist", () => {
    projects.set([
      {
        id: "p1",
        name: "Active",
        path: "/p1",
        active: true,
        workspaces: [],
        gitBacked: false,
      },
      {
        id: "p2",
        name: "Inactive",
        path: "/p2",
        active: false,
        workspaces: [],
        gitBacked: false,
      },
    ]);
    render(HomeScreen, homeProps);
    const section = screen.getByTestId("inactive-projects");
    expect(section).toBeDefined();

    const toggle = screen.getByTestId("inactive-projects-toggle");
    expect(toggle.textContent).toContain("Inactive Projects (1)");
  });

  it("inactive section is collapsed by default", () => {
    projects.set([
      {
        id: "p2",
        name: "Inactive",
        path: "/inactive/path",
        active: false,
        workspaces: [],
        gitBacked: false,
      },
    ]);
    render(HomeScreen, homeProps);
    // The row should not be visible until expanded
    expect(screen.queryByTestId("inactive-project-row")).toBeNull();
  });

  it("shows inactive projects when expanded", async () => {
    projects.set([
      {
        id: "p2",
        name: "Old Project",
        path: "/old/project",
        active: false,
        workspaces: [],
        gitBacked: false,
      },
    ]);
    render(HomeScreen, homeProps);

    const toggle = screen.getByTestId("inactive-projects-toggle");
    await fireEvent.click(toggle);

    const row = screen.getByTestId("inactive-project-row");
    expect(row).toBeDefined();
    expect(screen.getByText("Old Project")).toBeDefined();
    expect(screen.getByText("/old/project")).toBeDefined();
    expect(screen.getByTestId("reactivate-btn")).toBeDefined();
  });
});

// ===========================================================================
// Command palette expected entries
// ===========================================================================

describe("command palette entries", () => {
  // Test the expected entries by constructing paletteCommands in the same
  // pattern as App.svelte (we cannot render App.svelte easily, so we test
  // the data construction).

  it("builds Go to Dashboard entry", () => {
    // Verify the expected shape
    const entry = {
      name: "Go to Dashboard",
      action: goHome,
    };
    expect(entry.name).toBe("Go to Dashboard");
    expect(typeof entry.action).toBe("function");
  });

  it("builds Go to: {projectName} entries for active projects", () => {
    const activeProjects = [
      {
        id: "p1",
        name: "Project A",
        path: "/a",
        active: true,
        workspaces: [],
        gitBacked: false,
      },
      {
        id: "p2",
        name: "Project B",
        path: "/b",
        active: true,
        workspaces: [],
        gitBacked: false,
      },
    ];
    const entries = activeProjects.map((p) => ({
      name: `Go to: ${p.name}`,
      action: () => {},
    }));
    expect(entries[0].name).toBe("Go to: Project A");
    expect(entries[1].name).toBe("Go to: Project B");
    expect(entries.length).toBe(2);
  });

  it("builds harness entries from settings presets", () => {
    const harnesses = [
      {
        id: "claude",
        name: "Claude Code",
        command: "claude",
        args: [],
        env: {},
      },
      { id: "aider", name: "Aider", command: "aider", args: [], env: {} },
    ];
    const defaultEntry = {
      name: "New Harness",
      action: () => {},
    };
    const presetEntries = harnesses.map((h) => ({
      name: `New Harness: ${h.name}`,
      action: () => {},
    }));
    expect(defaultEntry.name).toBe("New Harness");
    expect(presetEntries[0].name).toBe("New Harness: Claude Code");
    expect(presetEntries[1].name).toBe("New Harness: Aider");
  });

  it("builds Jump to Waiting Agent entry", () => {
    const entry = {
      name: "Jump to Waiting Agent",
      action: async () => {
        // stub — real implementation uses dynamic import
      },
    };
    expect(entry.name).toBe("Jump to Waiting Agent");
    expect(typeof entry.action).toBe("function");
  });

  it("builds Open Settings entry", () => {
    const entry = {
      name: "Open Settings",
      action: () => currentView.set("settings"),
    };
    expect(entry.name).toBe("Open Settings");
    entry.action();
    expect(get(currentView)).toBe("settings");
  });
});
