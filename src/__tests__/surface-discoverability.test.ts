/**
 * Surface discoverability tests — contextual surface types (diff, filebrowser,
 * commithistory) appear in TabBar menus only when worktreePath is set.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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

// Mock git functions used by createContextualSurface
vi.mock("../lib/git", () => ({
  gitDiff: vi.fn(async () => "diff --git a/file.ts\n+added line"),
  gitLsFiles: vi.fn(async () => ["src/main.ts", "src/lib.ts", "package.json"]),
  gitLog: vi.fn(async () => [
    {
      hash: "abc123def456",
      shortHash: "abc123d",
      subject: "feat: initial commit",
      author: "Test Author",
      date: "2026-04-08",
    },
  ]),
}));

// ---------------------------------------------------------------------------
// Source imports (after mocks)
// ---------------------------------------------------------------------------

import { render, cleanup as testingCleanup } from "@testing-library/svelte";
import { get } from "svelte/store";
import TabBar from "../lib/components/TabBar.svelte";
import { contextMenu } from "../lib/stores/ui";
import { getSettings } from "../lib/settings";
import type { Pane, HarnessPreset } from "../lib/types";
import { uid } from "../lib/types";
import type { MenuItem } from "../lib/context-menu-types";
import { makeSurface } from "./helpers/mocks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};

function makeDiscoverabilityPane(): Pane {
  const surface = makeSurface(uid(), { title: "Shell" });
  return {
    id: uid(),
    surfaces: [surface],
    activeSurfaceId: null,
  };
}

function renderTabBar(overrides: Record<string, unknown> = {}) {
  const pane = makeDiscoverabilityPane();
  pane.activeSurfaceId = pane.surfaces[0].id;
  return render(TabBar, {
    props: {
      pane,
      onSelectSurface: noop,
      onCloseSurface: noop,
      onNewSurface: noop,
      onSplitRight: noop,
      onSplitDown: noop,
      onClosePane: noop,
      ...overrides,
    },
  });
}

function getMenuItems(): MenuItem[] {
  const menu = get(contextMenu);
  return menu?.items ?? [];
}

function getMenuLabels(): string[] {
  return getMenuItems()
    .filter((item) => !item.separator)
    .map((item) => item.label);
}

function hasSeparator(): boolean {
  return getMenuItems().some((item) => item.separator);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Surface discoverability — TabBar menus", () => {
  const testPresets: HarnessPreset[] = [
    {
      id: "claude",
      name: "Claude Code",
      command: "claude",
      args: [],
      env: {},
    },
  ];

  beforeEach(() => {
    testingCleanup();
    contextMenu.set(null);
    const settings = getSettings();
    Object.assign(settings, { harnesses: testPresets });
  });

  // =========================================================================
  // showNewSurfaceMenu — "+" button
  // =========================================================================

  describe("New surface menu (+)", () => {
    it("includes Diff, Files, Commits when worktreePath is set", () => {
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onNewContextualSurface: noop,
      });

      const plusBtn = container.querySelector("[title='New surface']");
      expect(plusBtn).toBeTruthy();

      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const labels = getMenuLabels();
      expect(labels).toContain("Terminal");
      expect(labels).toContain("Harness");
      expect(labels).toContain("Diff");
      expect(labels).toContain("Files");
      expect(labels).toContain("Commits");
    });

    it("does NOT include contextual items when worktreePath is not set", () => {
      const { container } = renderTabBar();

      const plusBtn = container.querySelector("[title='New surface']");
      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const labels = getMenuLabels();
      expect(labels).toContain("Terminal");
      expect(labels).toContain("Harness");
      expect(labels).not.toContain("Diff");
      expect(labels).not.toContain("Files");
      expect(labels).not.toContain("Commits");
    });

    it("shows a separator between harness presets and contextual items", () => {
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onNewContextualSurface: noop,
      });

      const plusBtn = container.querySelector("[title='New surface']");
      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(hasSeparator()).toBe(true);
    });

    it("does NOT show a separator when worktreePath is not set", () => {
      const { container } = renderTabBar();

      const plusBtn = container.querySelector("[title='New surface']");
      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(hasSeparator()).toBe(false);
    });

    it("calls onNewContextualSurface with 'diff' when Diff is clicked", () => {
      const handler = vi.fn();
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onNewContextualSurface: handler,
      });

      const plusBtn = container.querySelector("[title='New surface']");
      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const items = getMenuItems();
      const diffItem = items.find((i) => i.label === "Diff");
      expect(diffItem).toBeTruthy();
      diffItem!.action();
      expect(handler).toHaveBeenCalledWith("diff");
    });

    it("calls onNewContextualSurface with 'filebrowser' when Files is clicked", () => {
      const handler = vi.fn();
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onNewContextualSurface: handler,
      });

      const plusBtn = container.querySelector("[title='New surface']");
      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const items = getMenuItems();
      const filesItem = items.find((i) => i.label === "Files");
      filesItem!.action();
      expect(handler).toHaveBeenCalledWith("filebrowser");
    });

    it("calls onNewContextualSurface with 'commithistory' when Commits is clicked", () => {
      const handler = vi.fn();
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onNewContextualSurface: handler,
      });

      const plusBtn = container.querySelector("[title='New surface']");
      plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const items = getMenuItems();
      const commitsItem = items.find((i) => i.label === "Commits");
      commitsItem!.action();
      expect(handler).toHaveBeenCalledWith("commithistory");
    });
  });

  // =========================================================================
  // showSwitchSurfaceMenu — switch surface type button
  // =========================================================================

  describe("Switch surface menu", () => {
    it("includes Diff, Files, Commits when worktreePath is set", () => {
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onSwitchSurface: noop,
        onNewContextualSurface: noop,
      });

      const switchBtn = container.querySelector(
        "[title='Switch surface type']",
      );
      expect(switchBtn).toBeTruthy();

      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const labels = getMenuLabels();
      expect(labels).toContain("Terminal");
      expect(labels).toContain("Diff");
      expect(labels).toContain("Files");
      expect(labels).toContain("Commits");
    });

    it("does NOT include contextual items when worktreePath is not set", () => {
      const { container } = renderTabBar({
        onSwitchSurface: noop,
      });

      const switchBtn = container.querySelector(
        "[title='Switch surface type']",
      );
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const labels = getMenuLabels();
      expect(labels).toContain("Terminal");
      expect(labels).not.toContain("Diff");
      expect(labels).not.toContain("Files");
      expect(labels).not.toContain("Commits");
    });

    it("calls onSwitchSurface with 'diff' when Diff is clicked", () => {
      const handler = vi.fn();
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onSwitchSurface: handler,
      });

      const switchBtn = container.querySelector(
        "[title='Switch surface type']",
      );
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const items = getMenuItems();
      const diffItem = items.find((i) => i.label === "Diff");
      diffItem!.action();
      expect(handler).toHaveBeenCalledWith("diff");
    });

    it("calls onSwitchSurface with 'filebrowser' when Files is clicked", () => {
      const handler = vi.fn();
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onSwitchSurface: handler,
      });

      const switchBtn = container.querySelector(
        "[title='Switch surface type']",
      );
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const items = getMenuItems();
      const filesItem = items.find((i) => i.label === "Files");
      filesItem!.action();
      expect(handler).toHaveBeenCalledWith("filebrowser");
    });

    it("calls onSwitchSurface with 'commithistory' when Commits is clicked", () => {
      const handler = vi.fn();
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onSwitchSurface: handler,
      });

      const switchBtn = container.querySelector(
        "[title='Switch surface type']",
      );
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const items = getMenuItems();
      const commitsItem = items.find((i) => i.label === "Commits");
      commitsItem!.action();
      expect(handler).toHaveBeenCalledWith("commithistory");
    });

    it("shows separator before contextual items", () => {
      const { container } = renderTabBar({
        worktreePath: "/repo/worktrees/feature",
        onSwitchSurface: noop,
      });

      const switchBtn = container.querySelector(
        "[title='Switch surface type']",
      );
      switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(hasSeparator()).toBe(true);
    });
  });
});

// ===========================================================================
// Contextual surface creation logic (unit tests for the surface factory)
// ===========================================================================

describe("Contextual surface creation", () => {
  it("DiffSurface type has correct shape", async () => {
    const { gitDiff } = await import("../lib/git");
    const diffContent = await gitDiff("/repo/worktrees/feature");

    const surface = {
      kind: "diff" as const,
      id: uid(),
      title: "Diff",
      worktreePath: "/repo/worktrees/feature",
      diffContent,
      hasUnread: false,
    };

    expect(surface.kind).toBe("diff");
    expect(surface.worktreePath).toBe("/repo/worktrees/feature");
    expect(surface.diffContent).toContain("diff --git");
    expect(surface.hasUnread).toBe(false);
  });

  it("FileBrowserSurface type has correct shape", async () => {
    const { gitLsFiles } = await import("../lib/git");
    const files = await gitLsFiles("/repo/worktrees/feature");

    const surface = {
      kind: "filebrowser" as const,
      id: uid(),
      title: "Files",
      worktreePath: "/repo/worktrees/feature",
      files,
      hasUnread: false,
    };

    expect(surface.kind).toBe("filebrowser");
    expect(surface.files).toEqual([
      "src/main.ts",
      "src/lib.ts",
      "package.json",
    ]);
    expect(surface.hasUnread).toBe(false);
  });

  it("CommitHistorySurface type has correct shape", async () => {
    const { gitLog } = await import("../lib/git");
    const commits = await gitLog("/repo/worktrees/feature", "main");

    const surface = {
      kind: "commithistory" as const,
      id: uid(),
      title: "Commits",
      worktreePath: "/repo/worktrees/feature",
      baseBranch: "main",
      commits,
      hasUnread: false,
    };

    expect(surface.kind).toBe("commithistory");
    expect(surface.baseBranch).toBe("main");
    expect(surface.commits).toHaveLength(1);
    expect(surface.commits[0].shortHash).toBe("abc123d");
    expect(surface.hasUnread).toBe(false);
  });

  it("gitDiff is called with worktreePath", async () => {
    const { gitDiff } = await import("../lib/git");
    await gitDiff("/repo/worktrees/feature");
    expect(gitDiff).toHaveBeenCalledWith("/repo/worktrees/feature");
  });

  it("gitLsFiles is called with worktreePath", async () => {
    const { gitLsFiles } = await import("../lib/git");
    await gitLsFiles("/repo/worktrees/feature");
    expect(gitLsFiles).toHaveBeenCalledWith("/repo/worktrees/feature");
  });

  it("gitLog is called with worktreePath and baseBranch", async () => {
    const { gitLog } = await import("../lib/git");
    await gitLog("/repo/worktrees/feature", "main");
    expect(gitLog).toHaveBeenCalledWith("/repo/worktrees/feature", "main");
  });
});

// ===========================================================================
// Menu item ordering
// ===========================================================================

describe("Menu item ordering", () => {
  beforeEach(() => {
    testingCleanup();
    contextMenu.set(null);
    const settings = getSettings();
    Object.assign(settings, {
      harnesses: [
        {
          id: "claude",
          name: "Claude Code",
          command: "claude",
          args: [],
          env: {},
        },
        {
          id: "copilot",
          name: "Copilot",
          command: "gh",
          args: ["copilot"],
          env: {},
        },
      ],
    });
  });

  it("new surface menu orders: Terminal, harnesses, separator, contextual", () => {
    const { container } = renderTabBar({
      worktreePath: "/repo",
      onNewContextualSurface: noop,
    });

    const plusBtn = container.querySelector("[title='New surface']");
    plusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const items = getMenuItems();
    // Terminal
    expect(items[0].label).toBe("Terminal");
    expect(items[0].separator).toBeFalsy();
    // Harness (single entry for default)
    expect(items[1].label).toBe("Harness");
    // Separator
    expect(items[2].separator).toBe(true);
    // Contextual items
    expect(items[3].label).toBe("Diff");
    expect(items[4].label).toBe("Files");
    expect(items[5].label).toBe("Commits");
  });

  it("switch surface menu orders: Terminal, harnesses, separator, contextual", () => {
    const { container } = renderTabBar({
      worktreePath: "/repo",
      onSwitchSurface: noop,
    });

    const switchBtn = container.querySelector("[title='Switch surface type']");
    switchBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const items = getMenuItems();
    expect(items[0].label).toBe("Terminal");
    expect(items[1].label).toBe("Harness");
    expect(items[2].separator).toBe(true);
    expect(items[3].label).toBe("Diff");
    expect(items[4].label).toBe("Files");
    expect(items[5].label).toBe("Commits");
  });
});
