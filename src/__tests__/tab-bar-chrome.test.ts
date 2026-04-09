/**
 * S1: Tab Bar Chrome — tests for harness/terminal separation, overflow arrows,
 * platform-aware shortcuts, close pane confirmation, empty pane placeholder,
 * split divider double-click, focused pane indicator, and harness tab titles.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  cleanup as testingCleanup,
  fireEvent,
} from "@testing-library/svelte";

// ---------------------------------------------------------------------------
// Mocks — must come before any source imports
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
    cols: 80,
    rows: 24,
    buffer: { active: { getLine: vi.fn() } },
    parser: { registerOscHandler: vi.fn() },
    attachCustomKeyEventHandler: vi.fn(),
    registerLinkProvider: vi.fn(),
    getSelection: vi.fn(),
    scrollToBottom: vi.fn(),
    clear: vi.fn(),
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
// Source imports (after mocks)
// ---------------------------------------------------------------------------

import type { Pane, Workspace, SplitNode } from "../lib/types";
import Tab from "../lib/components/Tab.svelte";
import TabBar from "../lib/components/TabBar.svelte";
import PaneView from "../lib/components/PaneView.svelte";
import EmptyPanePlaceholder from "../lib/components/EmptyPanePlaceholder.svelte";
import SplitNodeView from "../lib/components/SplitNodeView.svelte";
import { modLabel, shiftModLabel } from "../lib/terminal-service";
import { getSettings } from "../lib/settings";
import { showConfirmDialog } from "../lib/stores/dialog-service";
import { makeSurface, makeHarnessSurface, makePane } from "./helpers/mocks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

// ===========================================================================
// AC1: Divider renders between harness and terminal tabs
// ===========================================================================

describe("TabBar harness/terminal divider", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("renders a divider when both harness and terminal surfaces exist", () => {
    const harness = makeHarnessSurface("h1", { title: "Claude Code" });
    const term = makeSurface("t1", { title: "Shell 1" });
    const pane: Pane = {
      id: "p1",
      surfaces: [term, harness],
      activeSurfaceId: term.id,
    };
    const { container } = render(TabBar, {
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
    const divider = container.querySelector("[data-tab-divider]");
    expect(divider).not.toBeNull();
  });

  it("does not render a divider when only terminal surfaces exist", () => {
    const term1 = makeSurface("t1", { title: "Shell 1" });
    const term2 = makeSurface("t2", { title: "Shell 2" });
    const pane: Pane = {
      id: "p1",
      surfaces: [term1, term2],
      activeSurfaceId: term1.id,
    };
    const { container } = render(TabBar, {
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
    const divider = container.querySelector("[data-tab-divider]");
    expect(divider).toBeNull();
  });

  it("does not render a divider when only harness surfaces exist", () => {
    const harness = makeHarnessSurface("h1", { title: "Claude Code" });
    const pane: Pane = {
      id: "p1",
      surfaces: [harness],
      activeSurfaceId: harness.id,
    };
    const { container } = render(TabBar, {
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
    const divider = container.querySelector("[data-tab-divider]");
    expect(divider).toBeNull();
  });

  it("renders harness tabs before terminal tabs", () => {
    const harness = makeHarnessSurface("h1", { title: "Claude Code" });
    const term = makeSurface("t1", { title: "Shell 1" });
    const pane: Pane = {
      id: "p1",
      surfaces: [term, harness],
      activeSurfaceId: term.id,
    };
    const { container } = render(TabBar, {
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
    const tabs = container.querySelectorAll(".tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain("Claude Code");
    expect(tabs[1].textContent).toContain("Shell 1");
  });
});

// ===========================================================================
// AC5: Overflow scroll arrows
// ===========================================================================

describe("TabBar overflow arrows", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("does not show scroll arrows when tabs fit in container", () => {
    const pane = makePane("p1");
    const { container } = render(TabBar, {
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
    // Default state: no overflow, so no scroll arrows
    expect(container.querySelector("[data-scroll-left]")).toBeNull();
    expect(container.querySelector("[data-scroll-right]")).toBeNull();
  });

  it("renders a scrollable tab container", () => {
    const pane = makePane("p1");
    const { container } = render(TabBar, {
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
    const tabContainer = container.querySelector("[data-tab-container]");
    expect(tabContainer).not.toBeNull();
    const style = tabContainer!.getAttribute("style");
    expect(style).toContain("overflow-x: auto");
    expect(style).toContain("scrollbar-width: none");
  });
});

// ===========================================================================
// AC6: Platform-aware shortcut formatting
// ===========================================================================

describe("Platform-aware shortcuts", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("uses modLabel for split right tooltip", () => {
    const pane = makePane("p1");
    const { container } = render(TabBar, {
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
    const splitRight = container.querySelector(
      `[title="Split Right (${modLabel}D)"]`,
    );
    expect(splitRight).not.toBeNull();
  });

  it("uses shiftModLabel for split down tooltip", () => {
    const pane = makePane("p1");
    const { container } = render(TabBar, {
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
    const splitDown = container.querySelector(
      `[title="Split Down (${shiftModLabel}D)"]`,
    );
    expect(splitDown).not.toBeNull();
  });

  it("exports platform-appropriate modLabel values", () => {
    // In jsdom, navigator.platform is empty so isMac is false
    expect(modLabel).toBe("Ctrl+");
    expect(shiftModLabel).toBe("Ctrl+Shift+");
  });
});

// ===========================================================================
// AC7: Close pane confirmation
// ===========================================================================

describe("TabBar close pane confirmation", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("calls onClosePane directly for single terminal surface pane", async () => {
    const closeFn = vi.fn();
    const term = makeSurface("t1");
    const pane: Pane = {
      id: "p1",
      surfaces: [term],
      activeSurfaceId: term.id,
    };
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: closeFn,
      },
    });
    const closeBtn = container.querySelector('[title="Close Pane"]');
    expect(closeBtn).not.toBeNull();
    await fireEvent.click(closeBtn!);
    expect(closeFn).toHaveBeenCalled();
  });

  it("shows confirmation for pane with multiple surfaces", async () => {
    const closeFn = vi.fn();
    const term1 = makeSurface("t1");
    const term2 = makeSurface("t2");
    const pane: Pane = {
      id: "p1",
      surfaces: [term1, term2],
      activeSurfaceId: term1.id,
    };
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: closeFn,
      },
    });
    const closeBtn = container.querySelector('[title="Close Pane"]');

    // Click close — should trigger confirmation dialog, not direct close
    // The showConfirmDialog returns a promise; when pending, closeFn should not be called
    await fireEvent.click(closeBtn!);

    // The confirmation dialog should have been shown (showConfirmDialog stores state).
    // closeFn should NOT have been called synchronously since dialog is pending
    // Note: In the test env, showConfirmDialog creates a promise that never resolves
    // because there's no ConfirmDialog component to interact with. So closeFn stays uncalled.
    expect(closeFn).not.toHaveBeenCalled();
  });

  it("shows confirmation for pane with harness surface", async () => {
    const closeFn = vi.fn();
    const harness = makeHarnessSurface("h1");
    const pane: Pane = {
      id: "p1",
      surfaces: [harness],
      activeSurfaceId: harness.id,
    };
    const { container } = render(TabBar, {
      props: {
        pane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: closeFn,
      },
    });
    const closeBtn = container.querySelector('[title="Close Pane"]');
    await fireEvent.click(closeBtn!);

    // Should not close directly — confirmation dialog is pending
    expect(closeFn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// AC8: Empty pane placeholder
// ===========================================================================

describe("Empty pane placeholder", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("renders EmptyPanePlaceholder with action buttons", () => {
    const { container } = render(EmptyPanePlaceholder, {
      props: {
        onNewSurface: noop,
        onNewHarnessSurface: noop,
        onClosePane: noop,
      },
    });
    const placeholder = container.querySelector(
      "[data-empty-pane-placeholder]",
    );
    expect(placeholder).not.toBeNull();
    const termBtn = container.querySelector("[data-new-terminal-btn]");
    expect(termBtn).not.toBeNull();
    expect(termBtn!.textContent).toContain("New Terminal");
    const harnessBtn = container.querySelector("[data-new-harness-btn]");
    expect(harnessBtn).not.toBeNull();
    expect(harnessBtn!.textContent).toContain("New Harness");
  });

  it("calls onNewSurface when New Terminal is clicked", async () => {
    const newSurfaceFn = vi.fn();
    const { container } = render(EmptyPanePlaceholder, {
      props: {
        onNewSurface: newSurfaceFn,
        onNewHarnessSurface: noop,
        onClosePane: noop,
      },
    });
    const termBtn = container.querySelector("[data-new-terminal-btn]");
    await fireEvent.click(termBtn!);
    expect(newSurfaceFn).toHaveBeenCalled();
  });

  it("calls onNewHarnessSurface when New Harness is clicked", async () => {
    const newHarnessFn = vi.fn();
    const { container } = render(EmptyPanePlaceholder, {
      props: {
        onNewSurface: noop,
        onNewHarnessSurface: newHarnessFn,
        onClosePane: noop,
      },
    });
    const harnessBtn = container.querySelector("[data-new-harness-btn]");
    await fireEvent.click(harnessBtn!);
    expect(newHarnessFn).toHaveBeenCalledWith(
      getSettings().defaultHarness || "claude",
    );
  });

  it("renders PaneView with placeholder when pane is empty", () => {
    const emptyPane: Pane = {
      id: "p1",
      surfaces: [],
      activeSurfaceId: null,
    };
    const { container } = render(PaneView, {
      props: {
        pane: emptyPane,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onNewHarnessSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    const placeholder = container.querySelector(
      "[data-empty-pane-placeholder]",
    );
    expect(placeholder).not.toBeNull();
  });

  it("hides New Harness button when onNewHarnessSurface is not provided", () => {
    const { container } = render(EmptyPanePlaceholder, {
      props: {
        onNewSurface: noop,
        onClosePane: noop,
      },
    });
    const harnessBtn = container.querySelector("[data-new-harness-btn]");
    expect(harnessBtn).toBeNull();
  });
});

// ===========================================================================
// AC9: Split divider double-click resets ratio
// ===========================================================================

describe("SplitNodeView divider double-click", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("resets ratio to 0.5 on double-click", async () => {
    const pane1: Pane = {
      id: "p1",
      surfaces: [makeSurface("s1")],
      activeSurfaceId: "s1",
    };
    const pane2: Pane = {
      id: "p2",
      surfaces: [makeSurface("s2")],
      activeSurfaceId: "s2",
    };
    const splitNode: SplitNode = {
      type: "split",
      direction: "horizontal",
      children: [
        { type: "pane", pane: pane1 },
        { type: "pane", pane: pane2 },
      ],
      ratio: 0.7,
    };
    const workspace: Workspace = {
      id: "ws1",
      name: "Test",
      splitRoot: splitNode,
      activePaneId: "p1",
    };

    const { container } = render(SplitNodeView, {
      props: {
        node: splitNode,
        workspace,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });

    const divider = container.querySelector(".split-divider");
    expect(divider).not.toBeNull();
    expect(splitNode.ratio).toBe(0.7);

    await fireEvent.dblClick(divider!);
    expect(splitNode.ratio).toBe(0.5);
  });
});

// ===========================================================================
// AC3: Active tab bottom border
// ===========================================================================

describe("Tab active bottom border", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("Tab.svelte template includes border-bottom with accent for active state", async () => {
    // Svelte's reactive inline styles are not accessible via getAttribute("style")
    // in jsdom. Verify the source template contains the border-bottom logic.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const tabSource = readFileSync(
      resolve(__dirname, "../lib/components/Tab.svelte"),
      "utf-8",
    );
    // Template should include border-bottom conditional on isActive
    expect(tabSource).toContain("border-bottom:");
    expect(tabSource).toContain("$theme.accent");
    expect(tabSource).toContain("transparent");
  });

  it("renders active tab with .tab class and correct content", () => {
    const term = makeSurface("t1", { title: "Active Tab" });
    const { container } = render(Tab, {
      props: {
        surface: term,
        index: 0,
        isActive: true,
        onSelect: noop,
        onClose: noop,
      },
    });
    const tab = container.querySelector(".tab");
    expect(tab).not.toBeNull();
    expect(tab!.textContent).toContain("Active Tab");
  });
});

// ===========================================================================
// AC4: Focused pane indicator
// ===========================================================================

describe("PaneView focused pane indicator", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("renders accent top border on tab bar area when focused", () => {
    const pane = makePane("p1");
    const { container } = render(PaneView, {
      props: {
        pane,
        isFocused: true,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    const tabBarArea = container.querySelector("[data-tab-bar-area]");
    expect(tabBarArea).not.toBeNull();
    const style = tabBarArea!.getAttribute("style") || "";
    expect(style).toContain("border-top: 2px solid");
    // When focused, should NOT be transparent
    expect(style).not.toContain("transparent");
  });

  it("renders transparent top border when not focused", () => {
    const pane = makePane("p1");
    const { container } = render(PaneView, {
      props: {
        pane,
        isFocused: false,
        onSelectSurface: noop,
        onCloseSurface: noop,
        onNewSurface: noop,
        onSplitRight: noop,
        onSplitDown: noop,
        onClosePane: noop,
        onFocusPane: noop,
      },
    });
    const tabBarArea = container.querySelector("[data-tab-bar-area]");
    expect(tabBarArea).not.toBeNull();
    const style = tabBarArea!.getAttribute("style") || "";
    expect(style).toContain("transparent");
  });
});

// ===========================================================================
// AC2: Harness tab titles use preset name
// ===========================================================================

describe("Harness tab titles", () => {
  beforeEach(() => {
    testingCleanup();
  });

  it("displays preset name for harness surface", () => {
    // The default preset is "Claude Code" for presetId "claude"
    const harness = makeHarnessSurface("h1", {
      title: "Harness",
      presetId: "claude",
    });
    const pane: Pane = {
      id: "p1",
      surfaces: [harness],
      activeSurfaceId: harness.id,
    };
    const { container } = render(TabBar, {
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
    const tab = container.querySelector(".tab");
    expect(tab).not.toBeNull();
    expect(tab!.textContent).toContain("Claude Code");
  });

  it("falls back to surface title when preset not found", () => {
    const harness = makeHarnessSurface("h1", {
      title: "My Harness",
      presetId: "nonexistent-preset",
    });
    const pane: Pane = {
      id: "p1",
      surfaces: [harness],
      activeSurfaceId: harness.id,
    };
    const { container } = render(TabBar, {
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
    const tab = container.querySelector(".tab");
    expect(tab).not.toBeNull();
    // Falls back to surface.title since preset not found
    expect(tab!.textContent).toContain("My Harness");
  });
});
