/**
 * Svelte component render tests — verifies every component renders
 * the correct DOM structure, text content, and attributes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tick } from "svelte";
import { render, screen, cleanup, fireEvent } from "@testing-library/svelte";
// get is available if needed for store testing
import { readFileSync } from "fs";
import type { Workspace, Pane, TerminalSurface } from "../lib/types";

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
  writeImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return {
      open: vi.fn(),
      write: vi.fn(),
      focus: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      onTitleChange: vi.fn(),
      loadAddon: vi.fn(),
      options: {},
      buffer: { active: { getLine: vi.fn(), length: 0 } },
      rows: 24,
      parser: { registerOscHandler: vi.fn() },
      attachCustomKeyEventHandler: vi.fn(),
      registerLinkProvider: vi.fn(),
      getSelection: vi.fn(),
      hasSelection: vi.fn().mockReturnValue(false),
      onSelectionChange: vi.fn(),
      scrollToBottom: vi.fn(),
      onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn(), activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return { activate: vi.fn(), dispose: vi.fn(), onContextLoss: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return { activate: vi.fn(), dispose: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: vi.fn().mockImplementation(function () {
    return {
      activate: vi.fn(),
      dispose: vi.fn(),
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
    };
  }),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../lib/services/preview-service", () => ({
  openPreview: vi.fn().mockResolvedValue({
    element: document.createElement("div"),
    watchId: 0,
    dispose: vi.fn(),
  }),
  refreshPreviewElement: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/services/preview-surface-registry", () => ({
  registerPreviewSurface: vi.fn(),
  unregisterPreviewSurface: vi.fn(),
}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

// Mock ResizeObserver (not available in jsdom). Svelte 5.55.4 treats
// ResizeObserver as a constructor inside $effect — it must be a class,
// not a plain function, so vi.fn() no longer suffices.
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", MockResizeObserver);

// ---------------------------------------------------------------------------
// Component imports (after mocks)
// ---------------------------------------------------------------------------

import TitleBar from "../lib/components/TitleBar.svelte";
import FindBar from "../lib/components/FindBar.svelte";
import Tab from "../lib/components/Tab.svelte";
import TabBar from "../lib/components/TabBar.svelte";
import ContextMenu from "../lib/components/ContextMenu.svelte";
import CommandPalette from "../lib/components/CommandPalette.svelte";
import WorkspaceItem from "../lib/components/WorkspaceItem.svelte";
import PaneView from "../lib/components/PaneView.svelte";
import PrimarySidebar from "../lib/components/PrimarySidebar.svelte";
import SecondarySidebar from "../lib/components/SecondarySidebar.svelte";
import TerminalSurfaceComponent from "../lib/components/TerminalSurface.svelte";
import WorkspaceGroupSectionHarness from "./workspace-group-section-harness.svelte";

// Store imports
import {
  primarySidebarVisible,
  secondarySidebarVisible,
  commandPaletteOpen,
  findBarVisible,
  contextMenu,
  isFullscreen,
} from "../lib/stores/ui";
import {
  registerCommands,
  unregisterBySource,
} from "../lib/services/command-registry";
import { workspaces, activeWorkspaceIdx } from "../lib/stores/workspace";
import {
  registerSidebarSection,
  resetSidebarSections,
} from "../lib/services/sidebar-section-registry";
import {
  registerWorkspaceAction,
  resetWorkspaceActions,
} from "../lib/services/workspace-action-registry";
import { setWorkspaceGroups } from "../lib/stores/workspace-groups";
import type { WorkspaceGroupEntry } from "../lib/config";

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
      buffer: { active: { getLine: vi.fn(), length: 0 } },
      rows: 24,
      parser: { registerOscHandler: vi.fn() },
      attachCustomKeyEventHandler: vi.fn(),
      registerLinkProvider: vi.fn(),
      getSelection: vi.fn(),
      hasSelection: vi.fn().mockReturnValue(false),
      onSelectionChange: vi.fn(),
      onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    } as unknown as TerminalSurface["terminal"],
    fitAddon: { fit: vi.fn() } as unknown as TerminalSurface["fitAddon"],
    searchAddon: {
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
    } as unknown as TerminalSurface["searchAddon"],
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
  primarySidebarVisible.set(true);
  secondarySidebarVisible.set(false);
  commandPaletteOpen.set(false);
  findBarVisible.set(false);
  contextMenu.set(null);
  workspaces.set([]);
  activeWorkspaceIdx.set(-1);
  unregisterBySource("test");
});

// ===========================================================================
// TitleBar
// ===========================================================================

describe("TitleBar", () => {
  it("renders GNARTERM text", () => {
    render(TitleBar);
    const el =
      screen.queryByText("GNARTERM") ?? screen.queryByText("GNARTERM (DEV)");
    expect(el).toBeTruthy();
  });

  it("has data-tauri-drag-region attribute", () => {
    const { container } = render(TitleBar);
    const el = container.querySelector("[data-tauri-drag-region]");
    expect(el).toBeTruthy();
  });

  it("renders as a flex container with correct height", () => {
    const { container } = render(TitleBar);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.height).toBe("38px");
  });

  it("always renders both sidebar toggles", () => {
    const { container } = render(TitleBar);
    const primaryBtn = container.querySelector(
      "button[title^='Toggle Primary Sidebar']",
    );
    expect(primaryBtn).toBeTruthy();
    expect(screen.getByTitle("Toggle Secondary Sidebar")).toBeTruthy();
  });

  it("renders settings button", () => {
    const { container } = render(TitleBar);
    const settingsBtn = container.querySelector("button[title*='Settings']");
    expect(settingsBtn).toBeTruthy();
  });
});

// ===========================================================================
// SecondarySidebar
// ===========================================================================

describe("SecondarySidebar", () => {
  it("renders when secondarySidebarVisible is true", () => {
    secondarySidebarVisible.set(true);
    const { container } = render(SecondarySidebar);
    expect(container.querySelector("#secondary-sidebar")).toBeTruthy();
  });

  it("does not render when secondarySidebarVisible is false", () => {
    secondarySidebarVisible.set(false);
    const { container } = render(SecondarySidebar);
    expect(container.querySelector("#secondary-sidebar")).toBeNull();
  });

  it("has data-tauri-drag-region", () => {
    secondarySidebarVisible.set(true);
    const { container } = render(SecondarySidebar);
    const dragRegions = container.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThan(0);
  });

  it("shows empty state message when no tabs are registered", () => {
    secondarySidebarVisible.set(true);
    render(SecondarySidebar);
    expect(screen.getByText("No tabs registered")).toBeTruthy();
  });

  it("does not render toggle in header (lives in TitleBar)", () => {
    secondarySidebarVisible.set(true);
    render(SecondarySidebar);
    expect(screen.queryByTitle("Toggle Secondary Sidebar")).toBeNull();
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

  it("renders regex, case, and whole-word toggle buttons", () => {
    findBarVisible.set(true);
    render(FindBar);
    expect(screen.getByTitle("Use regular expression")).toBeTruthy();
    expect(screen.getByTitle("Match case")).toBeTruthy();
    expect(screen.getByTitle("Match whole word")).toBeTruthy();
  });

  it("passes regex:true to findNext when regex toggle is enabled", async () => {
    const surface = makeSurface("s1");
    const ws = makeWorkspace("w1", "test", makePane("p1", [surface]));
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    findBarVisible.set(true);
    render(FindBar);

    const input = screen.getByPlaceholderText("Find...") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "hello" } });

    const regexBtn = screen.getByTitle("Use regular expression");
    await fireEvent.click(regexBtn);

    const findNextSpy = surface.searchAddon.findNext as ReturnType<
      typeof vi.fn
    >;
    const lastCall = findNextSpy.mock.calls[findNextSpy.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({
      regex: true,
      caseSensitive: false,
      wholeWord: false,
    });
  });

  it("passes caseSensitive:true to findNext when case toggle is enabled", async () => {
    const surface = makeSurface("s2");
    const ws = makeWorkspace("w2", "test", makePane("p2", [surface]));
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    findBarVisible.set(true);
    render(FindBar);

    const input = screen.getByPlaceholderText("Find...") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "hello" } });

    const caseBtn = screen.getByTitle("Match case");
    await fireEvent.click(caseBtn);

    const findNextSpy = surface.searchAddon.findNext as ReturnType<
      typeof vi.fn
    >;
    const lastCall = findNextSpy.mock.calls[findNextSpy.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({
      regex: false,
      caseSensitive: true,
      wholeWord: false,
    });
  });

  it("passes wholeWord:true to findNext when whole-word toggle is enabled", async () => {
    const surface = makeSurface("s3");
    const ws = makeWorkspace("w3", "test", makePane("p3", [surface]));
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    findBarVisible.set(true);
    render(FindBar);

    const input = screen.getByPlaceholderText("Find...") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "hello" } });

    const wordBtn = screen.getByTitle("Match whole word");
    await fireEvent.click(wordBtn);

    const findNextSpy = surface.searchAddon.findNext as ReturnType<
      typeof vi.fn
    >;
    const lastCall = findNextSpy.mock.calls[findNextSpy.mock.calls.length - 1];
    expect(lastCall[1]).toMatchObject({
      regex: false,
      caseSensitive: false,
      wholeWord: true,
    });
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
    // When hasUnread && !isActive, the tab renders 2 spans (dot + title) and 1 close button
    const spans = container.querySelectorAll(".tab span");
    expect(spans.length).toBe(2);
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
    // When isActive, the unread dot is not rendered — only title span + close button
    const spans = container.querySelectorAll(".tab span");
    expect(spans.length).toBe(1);
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
    // Without unread, only 1 span (title) + close button (not a span)
    const spans = container.querySelectorAll(".tab span");
    expect(spans.length).toBe(1);
  });

  // ---- a11y regression tests (F06) ----------------------------------------

  it("tab div has role=tab and aria-selected", () => {
    const surface = makeSurface("t1");
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
    expect(tab.getAttribute("role")).toBe("tab");
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("tabindex")).toBe("0");
  });

  it("Enter key on the tab div calls onSelect", async () => {
    const surface = makeSurface("t1");
    const onSelect = vi.fn();
    const { container } = render(Tab, {
      props: { surface, index: 0, isActive: false, onSelect, onClose: noop },
    });
    const tab = container.querySelector(".tab") as HTMLElement;
    fireEvent.keyDown(tab, { key: "Enter", target: tab, currentTarget: tab });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("Space key on the tab div calls onSelect", async () => {
    const surface = makeSurface("t1");
    const onSelect = vi.fn();
    const { container } = render(Tab, {
      props: { surface, index: 0, isActive: false, onSelect, onClose: noop },
    });
    const tab = container.querySelector(".tab") as HTMLElement;
    fireEvent.keyDown(tab, { key: " ", target: tab, currentTarget: tab });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("Enter on close button does not call onSelect (bubbling guard)", async () => {
    const surface = makeSurface("t1");
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(Tab, {
      props: { surface, index: 0, isActive: true, onSelect, onClose },
    });
    const closeBtn = container.querySelector(
      "button[aria-label='Close tab']",
    ) as HTMLElement;
    // Dispatch keydown directly on the close button — it bubbles to the tab
    // div, but handleTabKeydown should ignore it (target !== currentTarget).
    closeBtn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("close button has aria-label and is a button element", () => {
    const surface = makeSurface("t1");
    const { container } = render(Tab, {
      props: {
        surface,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
      },
    });
    const closeBtn = container.querySelector(
      "button[aria-label='Close tab']",
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.tagName).toBe("BUTTON");
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
        onSelectSurfaceType: noop,
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
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
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
        onSelectSurfaceType: noop,
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
        onSelectSurfaceType: noop,
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
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
      },
    });
    expect(screen.getByTitle("Close Pane")).toBeTruthy();
  });

  it("shows jump-to-bottom button when showJumpToBottom is true", () => {
    const pane = makePane("p1");
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        showJumpToBottom: true,
        onJumpToBottom: noop,
      },
    });
    expect(container.querySelector("[data-jump-to-bottom]")).not.toBeNull();
  });

  it("hides jump-to-bottom button when showJumpToBottom is false", () => {
    const pane = makePane("p1");
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        showJumpToBottom: false,
      },
    });
    expect(container.querySelector("[data-jump-to-bottom]")).toBeNull();
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

  // ---- a11y regression tests (F11) ----------------------------------------

  it("menu container has role=menu", () => {
    contextMenu.set({ x: 0, y: 0, items: [{ label: "Item", action: noop }] });
    const { container } = render(ContextMenu);
    const menu = container.querySelector("#context-menu") as HTMLElement;
    expect(menu.getAttribute("role")).toBe("menu");
  });

  it("menu items have role=menuitem and tabindex=-1", () => {
    contextMenu.set({
      x: 0,
      y: 0,
      items: [
        { label: "Copy", action: noop },
        { label: "Paste", action: noop },
      ],
    });
    const { container } = render(ContextMenu);
    const items = container.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
    items.forEach((item) => {
      expect((item as HTMLElement).getAttribute("tabindex")).toBe("-1");
    });
  });

  it("separator element has role=separator", () => {
    contextMenu.set({
      x: 0,
      y: 0,
      items: [
        { label: "Copy", action: noop },
        { label: "", action: noop, separator: true },
        { label: "Paste", action: noop },
      ],
    });
    const { container } = render(ContextMenu);
    const sep = container.querySelector('[role="separator"]');
    expect(sep).toBeTruthy();
  });

  it("ArrowDown/ArrowUp keyboard navigation is wired on the menu container", () => {
    contextMenu.set({
      x: 0,
      y: 0,
      items: [
        { label: "First", action: noop },
        { label: "Second", action: noop },
        { label: "Third", action: noop },
      ],
    });
    const { container } = render(ContextMenu);
    const menu = container.querySelector("#context-menu") as HTMLElement;
    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );

    // Spy on focus for each item and track calls.
    // Use a mutable "current active" so the handler's document.activeElement
    // lookup reflects which item was last focused.
    let activeItem: HTMLElement | null = null;
    const activeElementSpy = vi
      .spyOn(document, "activeElement", "get")
      .mockImplementation(() => activeItem);

    const focusCalls: HTMLElement[] = [];
    items.forEach((item) => {
      vi.spyOn(item, "focus").mockImplementation(() => {
        activeItem = item;
        focusCalls.push(item);
      });
    });

    // ArrowDown from first item should focus second
    activeItem = items[0]!;
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(focusCalls.at(-1)).toBe(items[1]);

    // ArrowUp from second item should focus first
    activeItem = items[1]!;
    menu.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(focusCalls.at(-1)).toBe(items[0]);

    activeElementSpy.mockRestore();
  });
});

// ===========================================================================
// CommandPalette
// ===========================================================================

describe("CommandPalette", () => {
  it("does not render when commandPaletteOpen is false", () => {
    commandPaletteOpen.set(false);
    const { container } = render(CommandPalette);
    expect(container.querySelector("#cmd-palette-overlay")).toBeNull();
  });

  it("renders overlay with input when open", () => {
    commandPaletteOpen.set(true);
    render(CommandPalette);
    expect(screen.getByPlaceholderText("Type a command...")).toBeTruthy();
  });

  it("renders command list from registry", () => {
    registerCommands([
      {
        id: "test.new-terminal",
        title: "New Terminal",
        action: noop,
        shortcut: "⌘T",
        source: "test",
      },
      {
        id: "test.close-tab",
        title: "Close Tab",
        action: noop,
        shortcut: "⌘W",
        source: "test",
      },
      {
        id: "test.toggle-sidebar",
        title: "Toggle Sidebar",
        action: noop,
        source: "test",
      },
    ]);
    commandPaletteOpen.set(true);
    render(CommandPalette);
    expect(screen.getByText("New Terminal")).toBeTruthy();
    expect(screen.getByText("Close Tab")).toBeTruthy();
    expect(screen.getByText("Toggle Sidebar")).toBeTruthy();
  });

  it("renders shortcuts for commands that have them", () => {
    registerCommands([
      {
        id: "test.new-terminal",
        title: "New Terminal",
        action: noop,
        shortcut: "⌘T",
        source: "test",
      },
    ]);
    commandPaletteOpen.set(true);
    render(CommandPalette);
    expect(screen.getByText("⌘T")).toBeTruthy();
  });

  it("renders the overlay element", () => {
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette);
    expect(container.querySelector("#cmd-palette-overlay")).toBeTruthy();
  });

  // ---- a11y regression tests (F07) ----------------------------------------

  it("overlay has role=dialog and aria-modal", () => {
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette);
    const overlay = container.querySelector(
      "#cmd-palette-overlay",
    ) as HTMLElement;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
  });

  it("input has aria-label", () => {
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-label")).toBe("Command search");
  });

  it("results container has role=listbox", () => {
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette);
    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
  });

  it("each command row has role=option and aria-selected", () => {
    registerCommands([
      { id: "test.cmd-a", title: "Cmd A", action: noop, source: "test" },
      { id: "test.cmd-b", title: "Cmd B", action: noop, source: "test" },
    ]);
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette);
    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    // First option is selected by default (selectedIdx = 0)
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(options[1]!.getAttribute("aria-selected")).toBe("false");
  });

  it("input aria-activedescendant points to selected option", () => {
    registerCommands([
      { id: "test.cmd-a", title: "Cmd A", action: noop, source: "test" },
    ]);
    commandPaletteOpen.set(true);
    const { container } = render(CommandPalette);
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.getAttribute("aria-activedescendant")).toBe("cmd-option-0");
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
      },
    });
  }

  it("renders the workspace name", () => {
    renderWorkspaceItem();
    expect(screen.getByText("My Workspace")).toBeTruthy();
  });

  it("renders close button in DragGrip when grip is expanded", async () => {
    const ws = makeWorkspace("ws1", "My Workspace");
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        onGripMouseDown: noop,
      },
    });
    // Hover the row — this makes the grip visible, which shows the × chip
    const row = container.firstElementChild as HTMLElement;
    await fireEvent.mouseEnter(row);
    await tick();
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
      },
    });
    const spanCountWithoutUnread =
      withoutUnread.querySelectorAll("span").length;

    // The unread variant should add spans for the chip (outer + inner dot)
    expect(spanCountWithUnread).toBeGreaterThan(spanCountWithoutUnread);
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
      },
    });
    const spanCountWithBadge = withUnread.querySelectorAll("span").length;

    // Without unread should have fewer spans
    expect(spanCountBase).toBeLessThan(spanCountWithBadge);
  });

  it("does not render surface/pane count metadata", () => {
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
      },
    });
    // Surface/pane counts are intentionally not rendered
    expect(screen.queryByText("2s")).toBeNull();
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
      },
    });
    expect(screen.getByText("Build complete")).toBeTruthy();
  });

  it("renders a presence-only chip when an agent is attached but idle", async () => {
    // Regression: launching claude in a workspace should immediately
    // show an identifier chip — even before the tracker transitions to
    // running/waiting. aggregateAgentBadges consumes process items from
    // the status registry; a muted item means "agent live, no active
    // work" and must render a visible dot.
    const { setStatusItem, clearAllStatusForWorkspace } =
      await import("../lib/services/status-registry");
    const ws = makeWorkspace("ws-agent", "Agent WS");
    setStatusItem("_agent", ws.id, "surface:s1", {
      category: "process",
      priority: 0,
      label: "idle",
      variant: "muted",
      metadata: { surfaceId: "s1" },
    });
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
      },
    });
    expect(
      container.querySelector("[data-agent-presence-chip]"),
    ).not.toBeNull();
    clearAllStatusForWorkspace(ws.id);
  });

  it("suppresses the notification row when nested inside a workspace group", () => {
    // Regression: nested workspaces render under a group's colored
    // banner that already rolls up status; the long blue notification
    // row duplicates chrome and crowds the nested layout, so it's
    // suppressed when metadata.groupId is set.
    const surface = makeSurface("s1", { notification: "Build complete" });
    const pane = makePane("p1", [surface]);
    const ws = makeWorkspace("ws1", "Nested WS", pane);
    ws.metadata = { groupId: "g1" };
    render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
      },
    });
    expect(screen.queryByText("Build complete")).toBeNull();
  });

  it("is reorderable via mouse drag", () => {
    const { container } = renderWorkspaceItem();
    const el = container.querySelector("[data-drag-idx]");
    expect(el).toBeTruthy();
  });

  it("has data-drag-idx attribute for mouse-based reordering", () => {
    const { container } = renderWorkspaceItem();
    const el = container.querySelector("[data-drag-idx]");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("data-drag-idx")).toBe("0");
  });

  it("uses mouse events for drag reorder (not HTML5 DnD)", () => {
    const listBlockSource = readFileSync(
      "src/lib/components/WorkspaceListBlock.svelte",
      "utf-8",
    );
    // Mouse-based drag system (shared utility — HTML5 DnD is broken
    // in Tauri WKWebView). Root-row drag now lives in
    // WorkspaceListBlock; PrimarySidebar is a thin host.
    expect(listBlockSource).toContain("createDragReorder");
    expect(listBlockSource).toContain("insertIndicator");
    expect(listBlockSource).toContain("dragActive");
  });

  it("applies accentColor as DragGrip railColor when provided", () => {
    const ws = makeWorkspace("ws1", "Accent WS");
    render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: false,
        accentColor: "#e06c75",
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
      },
    });
    // WorkspaceItem source should accept accentColor prop
    const source = readFileSync(
      "src/lib/components/WorkspaceItem.svelte",
      "utf-8",
    );
    expect(source).toContain("export let accentColor");
    expect(source).toContain("accentColor");
    // railColor falls back through dashboard entry color → accentColor prop → theme.accent
    expect(source).toContain("accentColor");
    expect(source).toContain("$theme.accent");
  });

  it("always renders the DragGrip dot pattern at full railColor (no solid-bg wrapper)", () => {
    const source = readFileSync(
      "src/lib/components/WorkspaceItem.svelte",
      "utf-8",
    );
    // railColor falls back through dashboard entry color → accentColor prop → theme.accent
    expect(source).toContain("accentColor");
    expect(source).toContain("$theme.accent");
    // alwaysShowDots + full opacity so the dot pattern reads at rest
    // without needing a colored wrapper bg (which would appear as a
    // solid "border" block).
    expect(source).toMatch(/alwaysShowDots=\{true\}/);
    expect(source).toMatch(/railOpacity=\{1\}/);
  });

  it("passes accentColor through WorkspaceListView", () => {
    const source = readFileSync(
      "src/lib/components/WorkspaceListView.svelte",
      "utf-8",
    );
    expect(source).toContain("export let accentColor");
    expect(source).toContain("{accentColor}");
  });

  it("does not render a dashboard icon when no dashboardHint is provided", () => {
    const { container } = renderWorkspaceItem();
    expect(
      container.querySelector("[data-workspace-dashboard-icon]"),
    ).toBeNull();
  });

  it("renders a clickable dashboard icon when dashboardHint is provided", async () => {
    const hintOnClick = vi.fn();
    const ws = makeWorkspace("ws-nested", "Nested WS");
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: false,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        dashboardHint: {
          id: "dash-1",
          color: "#ff8800",
          onClick: hintOnClick,
        },
      },
    });
    const icon = container.querySelector(
      "[data-workspace-dashboard-icon]",
    ) as HTMLElement | null;
    expect(icon).not.toBeNull();
    await fireEvent.click(icon!);
    expect(hintOnClick).toHaveBeenCalledTimes(1);
  });

  it("does not trigger workspace select when the dashboard icon is clicked", async () => {
    const onSelect = vi.fn();
    const hintOnClick = vi.fn();
    const ws = makeWorkspace("ws-nested", "Nested WS");
    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: false,
        onSelect,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
        dashboardHint: {
          id: "dash-1",
          color: "#ff8800",
          onClick: hintOnClick,
        },
      },
    });
    const icon = container.querySelector(
      "[data-workspace-dashboard-icon]",
    ) as HTMLElement;
    await fireEvent.click(icon);
    expect(hintOnClick).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
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
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    expect(screen.getByText("Pane Tab")).toBeTruthy();
  });

  it("does not render an Overview/Settings tab strip over Group Dashboards", () => {
    // The Settings dashboard is now its own contribution (gear icon,
    // auto-provisioned). PaneView no longer wraps the Group Dashboard
    // preview in an Overview/Settings tab strip.
    const ws: Workspace = {
      id: "ws-dash",
      name: "Dashboard",
      splitRoot: { type: "pane", pane: makePane("p1") },
      activePaneId: "p1",
      metadata: {
        isDashboard: true,
        groupId: "g1",
        dashboardContributionId: "group",
      },
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    const pane = ws.splitRoot.type === "pane" ? ws.splitRoot.pane : null;
    if (!pane) throw new Error("expected single-pane workspace");
    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: ws.id,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    expect(container.querySelector("[data-group-dashboard-tabs]")).toBeNull();
    expect(container.querySelector("[data-group-dashboard-tab]")).toBeNull();
  });

  it("renders GroupDashboardSettings for a settings-contribution workspace", () => {
    // Settings contribution → PaneView swaps the surface list for the
    // shared settings body.
    const ws: Workspace = {
      id: "ws-settings",
      name: "Settings",
      splitRoot: { type: "pane", pane: makePane("p1") },
      activePaneId: "p1",
      metadata: {
        isDashboard: true,
        groupId: "g1",
        dashboardContributionId: "settings",
      },
    };
    workspaces.set([ws]);
    activeWorkspaceIdx.set(0);
    const pane = ws.splitRoot.type === "pane" ? ws.splitRoot.pane : null;
    if (!pane) throw new Error("expected single-pane workspace");
    const { container } = render(PaneView, {
      props: {
        pane,
        workspaceId: ws.id,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    // GroupDashboardSettings renders a settings panel keyed by groupId.
    // Absent a matching group in the store it renders nothing, but the
    // render branch is still reached — no tab strip appears either way.
    expect(container.querySelector("[data-group-dashboard-tabs]")).toBeNull();
  });

  it("renders the + button via the embedded TabBar", () => {
    const pane = makePane("p1");
    render(PaneView, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    expect(screen.getByText("+")).toBeTruthy();
  });

  it("renders split and close pane controls", () => {
    const pane = makePane("p1");
    render(PaneView, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSelectSurfaceType: noop,
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

describe("PrimarySidebar", () => {
  const sidebarProps = {
    onSwitchWorkspace: noop,
    onRenameWorkspace: noop,
    onNewSurface: noop,
  };

  beforeEach(() => {
    resetSidebarSections();
    resetWorkspaceActions();
    cleanup();
  });

  it("renders when primarySidebarVisible is true", () => {
    primarySidebarVisible.set(true);
    const { container } = render(PrimarySidebar, { props: sidebarProps });
    expect(container.querySelector("#primary-sidebar")).toBeTruthy();
  });

  it("does not render when primarySidebarVisible is false", () => {
    primarySidebarVisible.set(false);
    const { container } = render(PrimarySidebar, { props: sidebarProps });
    expect(container.querySelector("#primary-sidebar")).toBeNull();
  });

  it("renders split button for workspace actions in the top row (sidebar toggles live in TitleBar)", () => {
    primarySidebarVisible.set(true);
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      shortcut: "Cmd+Shift+N",
      source: "core",
      handler: noop,
    });
    render(PrimarySidebar, { props: sidebarProps });
    // "+ New" now sits in the top (title) row alongside any sidebar-
    // zone action buttons — the old "Workspaces" header row inside
    // WorkspaceListBlock has been retired.
    expect(screen.getByText("+ New")).toBeTruthy();
    expect(screen.queryByText("Workspaces")).toBeNull();
    expect(screen.queryByTitle("Toggle Primary Sidebar (⌘B)")).toBeNull();
    expect(screen.queryByTitle("Toggle Secondary Sidebar")).toBeNull();
  });

  it("renders workspace items from store", () => {
    primarySidebarVisible.set(true);
    const ws1 = makeWorkspace("ws1", "Project Alpha");
    const ws2 = makeWorkspace("ws2", "Project Beta");
    workspaces.set([ws1, ws2]);
    activeWorkspaceIdx.set(0);
    render(PrimarySidebar, { props: sidebarProps });
    expect(screen.getByText("Project Alpha")).toBeTruthy();
    expect(screen.getByText("Project Beta")).toBeTruthy();
  });

  it("header has data-tauri-drag-region (when windowed, for traffic-light padding)", () => {
    primarySidebarVisible.set(true);
    isFullscreen.set(false);
    const { container } = render(PrimarySidebar, { props: sidebarProps });
    const dragRegions = container.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThan(0);
  });

  it("top row uses overflow:visible so SplitButton dropdown is not clipped", () => {
    // Regression: overflow:hidden on the 38px top row clipped the "+ New"
    // dropdown, making it invisible when opened. Must stay overflow:visible
    // so the absolutely-positioned menu can render below the row.
    primarySidebarVisible.set(true);
    const { container } = render(PrimarySidebar, { props: sidebarProps });
    const dragRegion = container.querySelector(
      "[data-tauri-drag-region]",
    ) as HTMLElement | null;
    expect(dragRegion).toBeTruthy();
    expect(dragRegion!.getAttribute("style")).toMatch(/overflow:\s*visible/);
  });

  it("keeps the top drag region bar rendered in fullscreen so layout stays stable", () => {
    // The primary sidebar's top row is always rendered — fullscreen toggle
    // should not swap branches, otherwise blocks snap into a new position.
    // In fullscreen the drag attributes are harmless no-ops (no window to
    // drag); the 38px acts as stable top padding.
    primarySidebarVisible.set(true);
    isFullscreen.set(true);
    const { container } = render(PrimarySidebar, { props: sidebarProps });
    const dragRegions = container.querySelectorAll("[data-tauri-drag-region]");
    expect(dragRegions.length).toBeGreaterThan(0);
    isFullscreen.set(false);
  });

  it("renders correct number of workspace items", () => {
    primarySidebarVisible.set(true);
    const ws1 = makeWorkspace("ws1", "WS One");
    const ws2 = makeWorkspace("ws2", "WS Two");
    const ws3 = makeWorkspace("ws3", "WS Three");
    workspaces.set([ws1, ws2, ws3]);
    activeWorkspaceIdx.set(1);
    render(PrimarySidebar, { props: sidebarProps });
    expect(screen.getByText("WS One")).toBeTruthy();
    expect(screen.getByText("WS Two")).toBeTruthy();
    expect(screen.getByText("WS Three")).toBeTruthy();
  });

  // Sections use collapsible:true so the content area doesn't render
  // (avoids needing a real Svelte component in tests)
  function makeSection(id: string, label: string, source: string) {
    return { id, label, component: "mock", source, collapsible: true };
  }

  it("does NOT show a 'Re-order Sections' button (reorder is implicit via grip)", () => {
    primarySidebarVisible.set(true);
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      source: "core",
      handler: noop,
    });
    registerSidebarSection(makeSection("s1", "Section 1", "ext-a"));
    registerSidebarSection(makeSection("s2", "Section 2", "ext-b"));

    render(PrimarySidebar, { props: { ...sidebarProps } });
    expect(screen.queryByTitle("Re-order Sections")).toBeNull();
  });

  it("does not show dropdown caret with no extension sections and no extra actions", () => {
    primarySidebarVisible.set(true);
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      source: "core",
      handler: noop,
    });
    render(PrimarySidebar, {
      props: { ...sidebarProps },
    });
    // Only 1 button (main), no caret
    const splitContainer = screen.getByText("+ New").closest("div")!;
    const buttons = splitContainer.querySelectorAll("button");
    expect(buttons.length).toBe(1);
  });

  it("renders extension-registered sidebar sections below the Workspaces block", () => {
    // The Workspaces section is no longer user-reorderable post-B,
    // and there are no block-level DragGrips at the top level.
    // Sections still render, they just can't be dragged.
    primarySidebarVisible.set(true);
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      source: "core",
      handler: noop,
    });
    registerSidebarSection(makeSection("s1", "Section 1", "ext-a"));
    registerSidebarSection(makeSection("s2", "Section 2", "ext-b"));

    render(PrimarySidebar, { props: { ...sidebarProps } });
    expect(screen.getByText("Section 1")).toBeTruthy();
    expect(screen.getByText("Section 2")).toBeTruthy();
  });

  it("renders sidebar-zone actions as buttons in the top row", () => {
    primarySidebarVisible.set(true);
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      source: "core",
      handler: noop,
    });
    registerWorkspaceAction({
      id: "ext:new-project",
      label: "New Project",
      icon: "folder-plus",
      zone: "sidebar",
      source: "ext",
      handler: noop,
    });
    render(PrimarySidebar, { props: sidebarProps });
    // Sidebar-zone action renders as a button in the top row
    expect(screen.getByTitle("New Project")).toBeTruthy();
    // Main split button reads "+ New" (lives in the same top row now).
    expect(screen.getByText("+ New")).toBeTruthy();
  });

  it("dropdown includes default action when workspace-zone extensions exist", async () => {
    primarySidebarVisible.set(true);
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      source: "core",
      handler: noop,
    });
    registerWorkspaceAction({
      id: "ext:new-worktree",
      label: "New Worktree",
      icon: "git-branch",
      source: "ext",
      handler: noop,
    });
    render(PrimarySidebar, { props: sidebarProps });
    // Open the dropdown by clicking the caret next to the "+ New" main button.
    // "New Workspace" is present only inside the dropdown menu items.
    const mainBtn = screen.getByText("+ New");
    const caretBtn = mainBtn
      .closest("div")!
      .querySelector("button:last-child") as HTMLElement;
    await fireEvent.click(caretBtn);
    // Dropdown includes both the default action and the extension action
    expect(screen.getByText("New Workspace")).toBeTruthy();
    expect(screen.getByText("New Worktree")).toBeTruthy();
  });
});

// ===========================================================================
// WorkspaceGroupSectionContent — per-group "+ New" split button
// ===========================================================================

describe("WorkspaceGroupSectionContent", () => {
  beforeEach(() => {
    resetWorkspaceActions();
    setWorkspaceGroups([]);
    cleanup();
  });

  it("picks up workspace actions registered AFTER the component mounts", async () => {
    // Regression: `$: actions = getWorkspaceActions().filter(...)` used to
    // read the store via `get()`, which doesn't create a Svelte dep. When
    // extensions activated after the component mounted (e.g. the worktree-
    // workspaces extension), the per-group "+ New" dropdown stayed stale
    // until the next render nudge. Now the statement reads the store
    // directly so extension-registered actions appear live.
    registerWorkspaceAction({
      id: "core:new-workspace",
      label: "New Workspace",
      icon: "plus",
      source: "core",
      handler: noop,
    });
    const group: WorkspaceGroupEntry = {
      id: "grp-1",
      name: "Test Group",
      path: "/tmp/test-group",
      color: "mint",
      workspaceIds: [],
      isGit: true,
      createdAt: new Date().toISOString(),
    };
    setWorkspaceGroups([group]);

    render(WorkspaceGroupSectionHarness, { props: { groupId: "grp-1" } });

    // Pre-registration: only the "+ New" main button, no caret.
    let splitContainer = screen.getByText("+ New").closest("div")!;
    expect(splitContainer.querySelectorAll("button").length).toBe(1);

    // Activate the worktree-workspaces-style action after mount.
    registerWorkspaceAction({
      id: "worktree-workspaces:create-worktree",
      label: "New Worktree",
      icon: "git-branch",
      source: "worktree-workspaces",
      handler: noop,
      when: (ctx) => !ctx.groupId || ctx.isGit === true,
    });
    await tick();

    // Caret now renders and the dropdown exposes the new action.
    splitContainer = screen.getByText("+ New").closest("div")!;
    const buttons = splitContainer.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    const caretBtn = buttons[buttons.length - 1] as HTMLElement;
    await fireEvent.click(caretBtn);
    expect(screen.getByText("New Worktree")).toBeTruthy();
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

  it("does not call scrollToBottom on store-churn re-render while already visible", async () => {
    const surface = makeSurface("no-churn-test", { opened: true });
    // Start visible
    const { rerender } = render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });
    await new Promise((r) => requestAnimationFrame(r));

    // Reset mocks after initial mount + first visible render
    (surface.fitAddon.fit as ReturnType<typeof vi.fn>).mockClear();
    (surface.terminal.scrollToBottom as ReturnType<typeof vi.fn>).mockClear();

    // Re-render with visible still true — simulates store churn (e.g. markSurfaceUnreadById)
    await rerender({ surface, visible: true });
    await new Promise((r) => requestAnimationFrame(r));

    // Edge-triggered block must NOT fire — visible did not transition false→true
    expect(surface.terminal.scrollToBottom).not.toHaveBeenCalled();
    expect(surface.fitAddon.fit).not.toHaveBeenCalled();
  });

  it("sets data-scrolled-up when terminal is scrolled up", async () => {
    const surface = makeSurface("jump-btn-test", { opened: true });
    let scrollCallback: ((pos: number) => void) | undefined;
    (surface.terminal.onScroll as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (pos: number) => void) => {
        scrollCallback = cb;
        return { dispose: vi.fn() };
      },
    );
    (surface.terminal.buffer.active as Record<string, unknown>).length = 100;
    (surface.terminal as Record<string, unknown>).rows = 24;

    const { container } = render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });

    // Not scrolled up at bottom
    expect(container.querySelector("[data-scrolled-up]")).toBeNull();

    // Simulate user scrolling up (pos 0 < 100-24=76)
    scrollCallback?.(0);
    await tick();

    expect(container.querySelector("[data-scrolled-up]")).not.toBeNull();
  });

  it("clears data-scrolled-up when user scrolls back to bottom", async () => {
    const surface = makeSurface("jump-btn-hide-test", { opened: true });
    let scrollCallback: ((pos: number) => void) | undefined;
    (surface.terminal.onScroll as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (pos: number) => void) => {
        scrollCallback = cb;
        return { dispose: vi.fn() };
      },
    );
    (surface.terminal.buffer.active as Record<string, unknown>).length = 100;
    (surface.terminal as Record<string, unknown>).rows = 24;

    const { container } = render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });

    // Scroll up
    scrollCallback?.(0);
    await tick();
    expect(container.querySelector("[data-scrolled-up]")).not.toBeNull();

    // Scroll back to bottom (pos 76 = 100-24)
    scrollCallback?.(76);
    await tick();
    expect(container.querySelector("[data-scrolled-up]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WorkspaceItem — harness sub-row
// ---------------------------------------------------------------------------

describe("WorkspaceItem — harness sub-row", () => {
  it("shows sub-row when the active surface has a detected agent", async () => {
    const { setStatusItem, clearAllStatusForWorkspace } =
      await import("../lib/services/status-registry");

    const surface = makeSurface("s1", { title: "claude > fixing bug" });
    const pane = makePane("p1", [surface]);
    const ws = makeWorkspace("ws-harness", "Harness WS", pane);

    setStatusItem("_agent", ws.id, "surface:s1", {
      category: "process",
      priority: 0,
      label: "running",
      variant: "success",
      metadata: { surfaceId: "s1" },
    });

    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
      },
    });

    const harnessEl = container.querySelector("[data-harness-title-row]");
    expect(harnessEl).not.toBeNull();
    expect(harnessEl?.getAttribute("title")).toBe("claude > fixing bug");
    clearAllStatusForWorkspace(ws.id);
  });

  it("hides sub-row when agent is on a non-active surface", async () => {
    const { setStatusItem, clearAllStatusForWorkspace } =
      await import("../lib/services/status-registry");

    const active = makeSurface("s-active", { title: "Shell" });
    const other = makeSurface("s-agent", { title: "claude" });
    const pane: Pane = {
      id: "p1",
      surfaces: [active, other],
      activeSurfaceId: "s-active",
    };
    const ws: Workspace = {
      id: "ws-hidden",
      name: "Hidden",
      splitRoot: { type: "pane", pane },
      activePaneId: "p1",
    };

    setStatusItem("_agent", ws.id, "surface:s-agent", {
      category: "process",
      priority: 0,
      label: "idle",
      variant: "muted",
      metadata: { surfaceId: "s-agent" },
    });

    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
      },
    });

    expect(container.querySelector("[data-harness-title-row]")).toBeNull();
    clearAllStatusForWorkspace(ws.id);
  });

  it("hides sub-row when hideStatusBadges is true", async () => {
    const { setStatusItem, clearAllStatusForWorkspace } =
      await import("../lib/services/status-registry");

    const surface = makeSurface("s1", { title: "claude" });
    const pane = makePane("p1", [surface]);
    const ws = makeWorkspace("ws-hidden2", "Hidden2", pane);

    setStatusItem("_agent", ws.id, "surface:s1", {
      category: "process",
      priority: 0,
      label: "idle",
      variant: "muted",
      metadata: { surfaceId: "s1" },
    });

    const { container } = render(WorkspaceItem, {
      props: {
        workspace: ws,
        index: 0,
        isActive: true,
        hideStatusBadges: true,
        onSelect: noop,
        onClose: noop,
        onRename: noop,
        onContextMenu: noop,
      },
    });

    expect(container.querySelector("[data-harness-title-row]")).toBeNull();
    clearAllStatusForWorkspace(ws.id);
  });
});

// ---------------------------------------------------------------------------
// TerminalSurface — image drag-drop
// ---------------------------------------------------------------------------

describe("TerminalSurface — image drag-drop", () => {
  it("sends \\x16 to PTY for image-only drop and writes image to clipboard", async () => {
    const { invoke: mockInvokeCore } = await import("@tauri-apps/api/core");
    const invokespy = vi.mocked(mockInvokeCore);
    const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const writeImageSpy = vi.mocked(writeImage);

    invokespy.mockClear();
    writeImageSpy.mockClear();

    const surface = makeSurface("s1", { ptyId: 42 });
    render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });

    // Simulate Tauri native drag-drop event with an image path
    const { listen } = await import("@tauri-apps/api/event");
    const listenSpy = vi.mocked(listen);
    const dragDropCallback = listenSpy.mock.calls
      .flatMap((c) => (c[0] === "tauri://drag-drop" ? [c[1]] : []))
      .at(-1) as ((e: { payload: { paths: string[] } }) => void) | undefined;

    if (dragDropCallback) {
      dragDropCallback({
        payload: { paths: ["/tmp/screenshot.png"] },
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(writeImageSpy).toHaveBeenCalledWith("/tmp/screenshot.png");
      const writePtyCall = invokespy.mock.calls.find(
        (c) =>
          c[0] === "write_pty" &&
          (c[1] as Record<string, unknown>)?.data === "\x16",
      );
      expect(writePtyCall).toBeDefined();
    }
  });

  it("sends shell-escaped path for non-image drop (unchanged behavior)", async () => {
    const { invoke: mockInvokeCore } = await import("@tauri-apps/api/core");
    const invokespy = vi.mocked(mockInvokeCore);
    invokespy.mockClear();

    const surface = makeSurface("s2", { ptyId: 43 });
    render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });

    const { listen } = await import("@tauri-apps/api/event");
    const listenSpy = vi.mocked(listen);
    const dragDropCallback = listenSpy.mock.calls
      .flatMap((c) => (c[0] === "tauri://drag-drop" ? [c[1]] : []))
      .at(-1) as ((e: { payload: { paths: string[] } }) => void) | undefined;

    if (dragDropCallback) {
      dragDropCallback({
        payload: { paths: ["/tmp/somefile.txt"] },
      });
      await new Promise((r) => setTimeout(r, 10));

      const writePtyCall = invokespy.mock.calls.find(
        (c) => c[0] === "write_pty",
      );
      expect(writePtyCall).toBeDefined();
      const data = (writePtyCall![1] as Record<string, unknown>)
        ?.data as string;
      expect(data).toContain("somefile.txt");
      expect(data).not.toBe("\x16");
    }
  });

  it("handles HTML5 drop of image file without .path (Mac screenshot thumbnail)", async () => {
    const { invoke: mockInvokeCore } = await import("@tauri-apps/api/core");
    const invokespy = vi.mocked(mockInvokeCore);
    const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const writeImageSpy = vi.mocked(writeImage);

    invokespy.mockClear();
    writeImageSpy.mockClear();

    const surface = makeSurface("s3", { ptyId: 44 });
    const { container } = render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });

    // Simulate a File with image MIME type but no .path (promised file)
    const imageBytes = new Uint8Array([137, 80, 78, 71]); // PNG magic bytes
    const imageFile = new File([imageBytes], "Screenshot.png", {
      type: "image/png",
    });
    // No .path property (unlike Tauri-extended File objects)

    // JSDOM doesn't implement DragEvent; use a plain Event with dataTransfer injected
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { files: [imageFile], items: [] },
    });

    const termDiv = container.firstElementChild as HTMLElement;
    termDiv.dispatchEvent(dropEvent);

    await vi.waitFor(() => {
      expect(writeImageSpy).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    });
    await vi.waitFor(() => {
      const writePtyCall = invokespy.mock.calls.find(
        (c) =>
          c[0] === "write_pty" &&
          (c[1] as Record<string, unknown>)?.data === "\x16",
      );
      expect(writePtyCall).toBeDefined();
    });
  });

  it("handles HTML5 drop via items when files is empty (some drag sources)", async () => {
    const { invoke: mockInvokeCore } = await import("@tauri-apps/api/core");
    const invokespy = vi.mocked(mockInvokeCore);
    const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const writeImageSpy = vi.mocked(writeImage);

    invokespy.mockClear();
    writeImageSpy.mockClear();

    const surface = makeSurface("s4", { ptyId: 45 });
    const { container } = render(TerminalSurfaceComponent, {
      props: { surface, visible: true },
    });

    const imageBytes = new Uint8Array([137, 80, 78, 71]);
    const imageFile = new File([imageBytes], "screenshot.png", {
      type: "image/png",
    });

    // JSDOM doesn't implement DragEvent; use a plain Event with dataTransfer injected
    const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: {
        files: [], // empty files list
        items: [
          { kind: "file", type: "image/png", getAsFile: () => imageFile },
        ],
      },
    });

    const termDiv = container.firstElementChild as HTMLElement;
    termDiv.dispatchEvent(dropEvent);

    await vi.waitFor(() => {
      expect(writeImageSpy).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    });
    await vi.waitFor(() => {
      const writePtyCall = invokespy.mock.calls.find(
        (c) =>
          c[0] === "write_pty" &&
          (c[1] as Record<string, unknown>)?.data === "\x16",
      );
      expect(writePtyCall).toBeDefined();
    });
  });
});

describe("PreviewSurface link interception", () => {
  it("clicking an https anchor calls open_url and prevents navigation", async () => {
    const { invoke: invokeFn } = await import("@tauri-apps/api/core");
    const invokeMockFn = vi.mocked(invokeFn);
    invokeMockFn.mockClear();

    const { default: PreviewSurface } =
      await import("../lib/components/PreviewSurface.svelte");
    const surface = {
      id: "ps-link-test",
      kind: "preview" as const,
      title: "Test",
      path: "/tmp/test.md",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { container } = render(PreviewSurface as any, {
      props: { surface, visible: true },
    });
    await tick();

    const previewRoot = container.querySelector("[data-preview-surface-id]")!;
    const a = document.createElement("a");
    a.href = "https://example.com";
    previewRoot.appendChild(a);

    const clickEvent = new MouseEvent("click", { bubbles: true });
    let defaultPrevented = false;
    clickEvent.preventDefault = () => {
      defaultPrevented = true;
    };
    a.dispatchEvent(clickEvent);

    expect(invokeMockFn).toHaveBeenCalledWith("open_url", {
      url: "https://example.com",
    });
    expect(defaultPrevented).toBe(true);
  });

  it("clicking a relative or anchor href does NOT call open_url", async () => {
    const { invoke: invokeFn } = await import("@tauri-apps/api/core");
    const invokeMockFn = vi.mocked(invokeFn);
    invokeMockFn.mockClear();

    // Re-use the same component render approach
    const { default: PreviewSurface } =
      await import("../lib/components/PreviewSurface.svelte");
    const surface = {
      id: "ps-link-test-neg",
      kind: "preview" as const,
      title: "Test",
      path: "/tmp/test2.md",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { container } = render(PreviewSurface as any, {
      props: { surface, visible: true },
    });
    await tick();

    const previewRoot = container.querySelector("[data-preview-surface-id]")!;

    for (const href of ["#section", "./page.html", "mailto:x@y.com"]) {
      const a = document.createElement("a");
      a.setAttribute("href", href);
      previewRoot.appendChild(a);
      a.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      a.remove();
    }

    expect(invokeMockFn).not.toHaveBeenCalledWith(
      "open_url",
      expect.anything(),
    );
  });
});

describe("terminal link handling", () => {
  it("registerLinkProvider is called and link activate invokes open_url", async () => {
    const { invoke: invokeMock } = await import("@tauri-apps/api/core");
    const invokeMockFn = vi.mocked(invokeMock);
    invokeMockFn.mockClear();

    const { Terminal: TerminalMock } = await import("@xterm/xterm");
    // TerminalMock is the mock constructor; instances track calls on the instance
    const TerminalCtor = vi.mocked(
      TerminalMock as unknown as new (...args: unknown[]) => {
        registerLinkProvider: ReturnType<typeof vi.fn>;
        loadAddon: ReturnType<typeof vi.fn>;
        buffer: { active: { getLine: ReturnType<typeof vi.fn> } };
      },
    );

    const { createTerminalSurface } = await import("../lib/terminal-service");
    const fakePane = {
      id: "p-link-plain-click",
      surfaces: [],
      activeSurfaceId: null,
    };
    await createTerminalSurface(
      fakePane as unknown as Parameters<typeof createTerminalSurface>[0],
    );

    const termInstance = TerminalCtor.mock.instances.at(-1)!;
    // 2 calls: URL provider (index 0, added by Task 5) + file-path provider (index 1, existing)
    expect(termInstance.registerLinkProvider).toHaveBeenCalledTimes(2);

    const provider = termInstance.registerLinkProvider.mock.calls[0][0] as {
      provideLinks: (
        line: number,
        cb: (
          links:
            | Array<{ activate: (e: MouseEvent, text: string) => void }>
            | undefined,
        ) => void,
      ) => void;
    };

    // Wire up the mock terminal's buffer so provideLinks can scan a real line
    const mockLine = {
      translateToString: vi
        .fn()
        .mockReturnValue("visit https://example.com/path for info"),
    };
    termInstance.buffer = {
      active: { getLine: vi.fn().mockReturnValue(mockLine) },
    };

    let capturedLinks:
      | Array<{ activate: (e: MouseEvent, text: string) => void }>
      | undefined;
    provider.provideLinks(1, (links) => {
      capturedLinks = links;
    });

    expect(capturedLinks).toBeDefined();
    expect(capturedLinks!.length).toBeGreaterThan(0);
    capturedLinks![0].activate(
      new MouseEvent("click"),
      "https://example.com/path",
    );
    expect(invokeMockFn).toHaveBeenCalledWith("open_url", {
      url: "https://example.com/path",
    });
  });
});
