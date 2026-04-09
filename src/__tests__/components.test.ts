/**
 * Svelte component render tests — verifies every component renders
 * the correct DOM structure, text content, and attributes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import type {
  Workspace,
  Pane,
  TerminalSurface,
  PreviewSurface,
  Surface,
  SplitNode,
} from "../lib/types";

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

// Mock ResizeObserver (not available in jsdom)
vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// ---------------------------------------------------------------------------
// Component imports (after mocks)
// ---------------------------------------------------------------------------

import TitleBar from "../lib/components/TitleBar.svelte";
import SidebarToggle from "../lib/components/SidebarToggle.svelte";
import FindBar from "../lib/components/FindBar.svelte";
import Tab from "../lib/components/Tab.svelte";
import TabBar from "../lib/components/TabBar.svelte";
import ContextMenu from "../lib/components/ContextMenu.svelte";
import CommandPalette from "../lib/components/CommandPalette.svelte";
import WorkspaceItem from "../lib/components/WorkspaceItem.svelte";
import PaneView from "../lib/components/PaneView.svelte";
import Sidebar from "../lib/components/Sidebar.svelte";
import TerminalSurfaceComponent from "../lib/components/TerminalSurface.svelte";

// Store imports
import {
  sidebarVisible,
  commandPaletteOpen,
  findBarVisible,
  contextMenu,
} from "../lib/stores/ui";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSurface(
  id: string,
  overrides: Partial<TerminalSurface> = {},
): TerminalSurface {
  return {
    kind: "terminal",
    id,
    terminal: {
      focus: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      scrollToBottom: vi.fn(),
      write: vi.fn(),
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
    } as any,
    fitAddon: { fit: vi.fn() } as any,
    searchAddon: {
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
    } as any,
    termElement: document.createElement("div"),
    ptyId: 1,
    title: `Shell ${id}`,
    hasUnread: false,
    opened: true,
    ...overrides,
  };
}

function makePane(id: string, surfaces?: TerminalSurface[]): Pane {
  const s = surfaces ?? [makeSurface(`${id}-s1`)];
  return {
    id,
    surfaces: s,
    activeSurfaceId: s[0].id,
  };
}

function makeWorkspace(id: string, name: string, pane?: Pane): Workspace {
  const p = pane ?? makePane(`${id}-p1`);
  return {
    id,
    name,
    splitRoot: { type: "pane", pane: p },
    activePaneId: p.id,
  };
}

const noop = () => {};

// ---------------------------------------------------------------------------
// Reset stores between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  cleanup();
  sidebarVisible.set(true);
  commandPaletteOpen.set(false);
  findBarVisible.set(false);
  contextMenu.set(null);
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
});

// ===========================================================================
// TitleBar
// ===========================================================================

describe("TitleBar", () => {
  it("renders GnarTerm text", () => {
    render(TitleBar);
    expect(screen.getByText("GnarTerm")).toBeTruthy();
  });

  it("has data-tauri-drag-region attribute", () => {
    const { container } = render(TitleBar);
    const el = container.querySelector("[data-tauri-drag-region]");
    expect(el).toBeTruthy();
  });

  it("renders with drag region", () => {
    const { container } = render(TitleBar);
    const el = container.querySelector("[data-tauri-drag-region]");
    expect(el).toBeTruthy();
  });
});

// ===========================================================================
// SidebarToggle
// ===========================================================================

describe("SidebarToggle", () => {
  it("renders toggle button when sidebar is hidden", () => {
    sidebarVisible.set(false);
    render(SidebarToggle);
    expect(screen.getByTitle("Show Sidebar (⌘B)")).toBeTruthy();
  });

  it("does not render when sidebar is visible", () => {
    sidebarVisible.set(true);
    const { container } = render(SidebarToggle);
    expect(container.querySelector("#sidebar-toggle")).toBeNull();
  });

  it("toggle button contains an SVG icon", () => {
    sidebarVisible.set(false);
    render(SidebarToggle);
    const btn = screen.getByTitle("Show Sidebar (⌘B)");
    expect(btn.querySelector("svg")).toBeTruthy();
  });
});

// ===========================================================================
// FindBar
// ===========================================================================

describe("FindBar", () => {
  it("renders search input when visible", () => {
    findBarVisible.set(true);
    render(FindBar);
    expect(screen.getByPlaceholderText("Find...")).toBeTruthy();
  });

  it("does not render when not visible", () => {
    findBarVisible.set(false);
    const { container } = render(FindBar);
    expect(container.querySelector("#find-bar")).toBeNull();
  });

  it("renders previous, next, and close buttons", () => {
    findBarVisible.set(true);
    render(FindBar);
    expect(screen.getByTitle("Previous match (⇧⌘G)")).toBeTruthy();
    expect(screen.getByTitle("Next match (⌘G)")).toBeTruthy();
    expect(screen.getByTitle("Close (Esc)")).toBeTruthy();
  });

  it("search input has text type", () => {
    findBarVisible.set(true);
    render(FindBar);
    const input = screen.getByPlaceholderText("Find...") as HTMLInputElement;
    expect(input.type).toBe("text");
  });
});

// ===========================================================================
// Tab
// ===========================================================================

describe("Tab", () => {
  it("renders the surface title", () => {
    const surface = makeSurface("t1", { title: "my-project" });
    render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
      },
    });
    expect(screen.getByText("my-project")).toBeTruthy();
  });

  it("falls back to Shell N when title is empty", () => {
    const surface = makeSurface("t1", { title: "" });
    render(Tab, {
      props: {
        surface,
        index: 2,
        isActive: false,
        onSelect: noop,
        onClose: noop,
      },
    });
    expect(screen.getByText("Shell 3")).toBeTruthy();
  });

  it("shows unread dot element when surface has unread and is not active", () => {
    const surface = makeSurface("t1", { hasUnread: true });
    const { container } = render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
      },
    });
    // When hasUnread && !isActive, the tab renders 3 spans: dot, title, close
    const spans = container.querySelectorAll(".tab span");
    expect(spans.length).toBe(3);
    // The first span is the unread dot (empty text content)
    expect(spans[0].textContent).toBe("");
  });

  it("does not show unread dot when tab is active", () => {
    const surface = makeSurface("t1", { hasUnread: true });
    const { container } = render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
      },
    });
    // When isActive, the unread dot is not rendered — only title and close spans
    const spans = container.querySelectorAll(".tab span");
    expect(spans.length).toBe(2);
  });

  it("renders close button (x symbol)", () => {
    const surface = makeSurface("t1");
    render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
      },
    });
    expect(screen.getByText("×")).toBeTruthy();
  });

  it("renders active tab with the tab class", () => {
    const surface = makeSurface("t1", { title: "active-tab" });
    const { container } = render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
      },
    });
    const tab = container.querySelector(".tab") as HTMLElement;
    expect(tab).toBeTruthy();
    // Verify the active tab renders its title
    expect(tab.textContent).toContain("active-tab");
  });

  it("inactive tab does not show unread dot when hasUnread is false", () => {
    const surface = makeSurface("t1", { hasUnread: false });
    const { container } = render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
      },
    });
    // Without unread, only 2 spans: title and close
    const spans = container.querySelectorAll(".tab span");
    expect(spans.length).toBe(2);
  });
});

// ===========================================================================
// TabBar
// ===========================================================================

describe("TabBar", () => {
  it("renders a tab for each surface", () => {
    const s1 = makeSurface("s1", { title: "Tab One" });
    const s2 = makeSurface("s2", { title: "Tab Two" });
    const pane = makePane("p1", [s1, s2]);
    render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    expect(screen.getByText("Tab One")).toBeTruthy();
    expect(screen.getByText("Tab Two")).toBeTruthy();
  });

  it("renders + button for new surface", () => {
    const pane = makePane("p1");
    render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    expect(screen.getByTitle("New surface")).toBeTruthy();
    expect(screen.getByText("+")).toBeTruthy();
  });

  it("renders split right button", () => {
    const pane = makePane("p1");
    render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    expect(screen.getByTitle("Split Right (⌘D)")).toBeTruthy();
  });

  it("renders split down button", () => {
    const pane = makePane("p1");
    render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    expect(screen.getByTitle("Split Down (⇧⌘D)")).toBeTruthy();
  });

  it("renders close pane button", () => {
    const pane = makePane("p1");
    render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    expect(screen.getByTitle("Close Pane")).toBeTruthy();
  });
});

// ===========================================================================
// ContextMenu
// ===========================================================================

describe("ContextMenu", () => {
  it("does not render when contextMenu store is null", () => {
    contextMenu.set(null);
    const { container } = render(ContextMenu);
    expect(container.querySelector("#context-menu")).toBeNull();
  });

  it("renders menu items when contextMenu store has state", () => {
    contextMenu.set({
      x: 100,
      y: 200,
      items: [
        { label: "Copy", action: noop, shortcut: "⌘C" },
        { label: "Paste", action: noop, shortcut: "⌘V" },
      ],
    });
    render(ContextMenu);
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.getByText("Paste")).toBeTruthy();
  });

  it("renders shortcut text for items that have shortcuts", () => {
    contextMenu.set({
      x: 100,
      y: 200,
      items: [{ label: "Copy", action: noop, shortcut: "⌘C" }],
    });
    render(ContextMenu);
    expect(screen.getByText("⌘C")).toBeTruthy();
  });

  it("renders separators between items", () => {
    contextMenu.set({
      x: 100,
      y: 200,
      items: [
        { label: "Copy", action: noop },
        { label: "", action: noop, separator: true },
        { label: "Close", action: noop, danger: true },
      ],
    });
    const { container } = render(ContextMenu);
    // Separator is a div with height: 1px
    const separators = container.querySelectorAll(
      "#context-menu > div[style*='height: 1px']",
    );
    expect(separators.length).toBe(1);
  });

  it("renders disabled items with reduced opacity", () => {
    contextMenu.set({
      x: 100,
      y: 200,
      items: [{ label: "Disabled Action", action: noop, disabled: true }],
    });
    const { container } = render(ContextMenu);
    const row = container.querySelector(".disabled") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.style.opacity).toBe("0.5");
  });
});

// ===========================================================================
// CommandPalette
// ===========================================================================

describe("CommandPalette", () => {
  it("does not render when commandPaletteOpen is false", () => {
    commandPaletteOpen.set(false);
    const { container } = render(CommandPalette, {
      props: {
        commands: [{ name: "Test Command", action: noop }],
      },
    });
    expect(container.querySelector("#cmd-palette-overlay")).toBeNull();
  });

  it("renders overlay with input when open", () => {
    commandPaletteOpen.set(true);
    render(CommandPalette, {
      props: {
        commands: [{ name: "New Terminal", action: noop }],
      },
    });
    expect(screen.getByPlaceholderText("Type a command...")).toBeTruthy();
  });

  it("renders command list", () => {
    commandPaletteOpen.set(true);
    render(CommandPalette, {
      props: {
        commands: [
          { name: "New Terminal", action: noop, shortcut: "⌘T" },
          { name: "Close Tab", action: noop, shortcut: "⌘W" },
          { name: "Toggle Sidebar", action: noop },
        ],
      },
    });
    expect(screen.getByText("New Terminal")).toBeTruthy();
    expect(screen.getByText("Close Tab")).toBeTruthy();
    expect(screen.getByText("Toggle Sidebar")).toBeTruthy();
  });

  it("renders shortcuts for commands that have them", () => {
    commandPaletteOpen.set(true);
    render(CommandPalette, {
      props: {
        commands: [{ name: "New Terminal", action: noop, shortcut: "⌘T" }],
      },
    });
    expect(screen.getByText("⌘T")).toBeTruthy();
  });

  it("renders the overlay element", () => {
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette, {
      props: { commands: [] },
    });
    expect(container.querySelector("#cmd-palette-overlay")).toBeTruthy();
  });
});

// ===========================================================================
// WorkspaceItem
// ===========================================================================

describe("WorkspaceItem", () => {
  function renderWorkspaceItem(
    wsOverrides: Partial<Workspace> = {},
    isActive = true,
  ) {
    const ws = makeWorkspace("ws1", "My Workspace");
    Object.assign(ws, wsOverrides);
    return render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onReorder: noop,
      },
    });
  }

  it("renders the workspace name", () => {
    renderWorkspaceItem();
    expect(screen.getByText("My Workspace")).toBeTruthy();
  });

  it("renders close button with correct title", () => {
    renderWorkspaceItem();
    expect(screen.getByTitle("Close Workspace (⇧⌘W)")).toBeTruthy();
  });

  it("renders close button with x symbol", () => {
    renderWorkspaceItem();
    // The close button renders the multiplication sign
    expect(screen.getByText("×")).toBeTruthy();
  });

  it("shows unread badge when surfaces have unread data", () => {
    const surface = makeSurface("s1", { hasUnread: true });
    const pane = makePane("p1", [surface]);
    const ws = makeWorkspace("ws1", "Unread WS", pane);
    const { container: withUnread } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onReorder: noop,
      },
    });
    // Count spans with unread vs without — the unread badge adds an extra empty span
    const spanCountWithUnread = withUnread.querySelectorAll("span").length;

    cleanup();

    const surfaceNoUnread = makeSurface("s2", { hasUnread: false });
    const paneNoUnread = makePane("p2", [surfaceNoUnread]);
    const wsNoUnread = makeWorkspace("ws2", "No Unread WS", paneNoUnread);
    const { container: withoutUnread } = render(WorkspaceItem, {
      props: {
        workspace: wsNoUnread,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onReorder: noop,
      },
    });
    const spanCountWithoutUnread =
      withoutUnread.querySelectorAll("span").length;

    // The unread variant should have one more span (the badge)
    expect(spanCountWithUnread).toBe(spanCountWithoutUnread + 1);
  });

  it("does not show unread badge when no surfaces have unread", () => {
    const { container: withoutUnread } = renderWorkspaceItem();
    const spanCountBase = withoutUnread.querySelectorAll("span").length;

    cleanup();

    // Render with unread to get the count with badge
    const surface = makeSurface("s1", { hasUnread: true });
    const pane = makePane("p1", [surface]);
    const ws = makeWorkspace("ws1", "Unread WS", pane);
    const { container: withUnread } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onReorder: noop,
      },
    });
    const spanCountWithBadge = withUnread.querySelectorAll("span").length;

    // Without unread should have fewer spans
    expect(spanCountBase).toBeLessThan(spanCountWithBadge);
  });

  it("renders metadata when multiple surfaces exist", () => {
    const s1 = makeSurface("s1");
    const s2 = makeSurface("s2");
    const pane: Pane = { id: "p1", surfaces: [s1, s2], activeSurfaceId: s1.id };
    const ws: Workspace = {
      id: "ws1",
      name: "Multi Surface",
      splitRoot: { type: "pane", pane },
      activePaneId: pane.id,
    };
    render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onReorder: noop,
      },
    });
    // Should show "2s" for 2 surfaces
    expect(screen.getByText("2s")).toBeTruthy();
  });

  it("renders notification text when a surface has a notification", () => {
    const surface = makeSurface("s1", { notification: "Build complete" });
    const pane = makePane("p1", [surface]);
    const ws = makeWorkspace("ws1", "Notified", pane);
    render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onReorder: noop,
      },
    });
    expect(screen.getByText("Build complete")).toBeTruthy();
  });

  it("is draggable", () => {
    const { container } = renderWorkspaceItem();
    const draggable = container.querySelector("[draggable='true']");
    expect(draggable).toBeTruthy();
  });
});

// ===========================================================================
// PaneView
// ===========================================================================

describe("PaneView", () => {
  it("renders tab bar with surfaces", () => {
    const s1 = makeSurface("s1", { title: "Pane Tab" });
    const pane = makePane("p1", [s1]);
    render(PaneView, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    expect(screen.getByText("Pane Tab")).toBeTruthy();
  });

  it("renders the + button via the embedded TabBar", () => {
    const pane = makePane("p1");
    render(PaneView, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    expect(screen.getByTitle("New surface")).toBeTruthy();
  });

  it("renders split and close pane controls", () => {
    const pane = makePane("p1");
    render(PaneView, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    expect(screen.getByTitle("Split Right (⌘D)")).toBeTruthy();
    expect(screen.getByTitle("Split Down (⇧⌘D)")).toBeTruthy();
    expect(screen.getByTitle("Close Pane")).toBeTruthy();
  });
});

// ===========================================================================
// Sidebar
// ===========================================================================

describe("Sidebar", () => {
  const sidebarProps = {
    onSwitchWorkspace: noop,
    onCloseWorkspace: noop,
    onRenameWorkspace: noop,
    onNewWorkspace: noop,
    onNewFloatingWorkspace: noop,
    onAddProject: noop,
  };

  it("renders when sidebarVisible is true", () => {
    sidebarVisible.set(true);
    const { container } = render(Sidebar, { props: sidebarProps });
    expect(container.querySelector("#sidebar")).toBeTruthy();
  });

  it("hides entirely when sidebarVisible is false", () => {
    sidebarVisible.set(false);
    const { container } = render(Sidebar, { props: sidebarProps });
    expect(container.querySelector("#sidebar")).toBeNull();
  });

  it("renders section headers", () => {
    sidebarVisible.set(true);
    render(Sidebar, { props: sidebarProps });
    expect(screen.getByText("Terminals")).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
  });

  it("does not render Personal section (removed)", () => {
    sidebarVisible.set(true);
    const ws1 = makeWorkspace("ws1", "Project Alpha");
    workspaces.set([ws1]);
    activeWorkspaceIdx.set(0);
    render(Sidebar, { props: sidebarProps });
    expect(screen.queryByText("Personal")).toBeNull();
  });

  it("renders Dashboard link in sidebar", () => {
    sidebarVisible.set(true);
    render(Sidebar, { props: sidebarProps });
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TerminalSurface
// ---------------------------------------------------------------------------

describe("TerminalSurface", () => {
  it("opens terminal and defers fit to after layout", async () => {
    const surface = makeSurface("fit-test", { opened: false });
    render(TerminalSurfaceComponent, { props: { surface, visible: true } });

    // open() is called synchronously in onMount
    expect(surface.terminal.open).toHaveBeenCalledWith(surface.termElement);
    // fit() is deferred via tick + rAF, so not called synchronously
    expect(surface.fitAddon.fit).not.toHaveBeenCalled();
  });

  it("does not call terminal.open on already-opened surfaces", () => {
    const surface = makeSurface("reopen-test", { opened: true });
    render(TerminalSurfaceComponent, { props: { surface, visible: true } });

    expect(surface.terminal.open).not.toHaveBeenCalled();
  });

  it("calls scrollToBottom after fit when pane becomes visible (#22)", async () => {
    const surface = makeSurface("scroll-test", { opened: true });
    // Start hidden
    const { rerender } = render(TerminalSurfaceComponent, {
      props: { surface, visible: false },
    });

    // Reset mocks from any mount-time calls
    (surface.fitAddon.fit as ReturnType<typeof vi.fn>).mockClear();
    (surface.terminal.scrollToBottom as ReturnType<typeof vi.fn>).mockClear();

    // Become visible — triggers the reactive block
    await rerender({ surface, visible: true });

    // The reactive block uses requestAnimationFrame, so flush it
    await new Promise((r) => requestAnimationFrame(r));

    expect(surface.fitAddon.fit).toHaveBeenCalled();
    expect(surface.terminal.scrollToBottom).toHaveBeenCalled();
  });
});
