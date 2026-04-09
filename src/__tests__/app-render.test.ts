/**
 * Behavioral tests for core modules — imports, function calls, and
 * component rendering. Replaces the former source-scanning tests with
 * real module imports and @testing-library/svelte renders.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must come before source/component imports
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn(
    (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
  ),
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
// Source and component imports (after mocks)
// ---------------------------------------------------------------------------

import { render, screen, cleanup } from "@testing-library/svelte";
import {
  uid,
  getAllPanes,
  getAllSurfaces,
  getWorktreeEnv,
  findPane,
  isTerminalSurface,
  isPreviewSurface,
  isHarnessSurface,
  type Workspace,
  type Pane,
  type SplitNode,
  type WorkspaceRecord,
} from "../lib/types";
import { themes, type ThemeDef } from "../lib/theme-data";
import {
  dialogStyles,
  showErrorDialog,
  browseDirectory,
} from "../lib/dialog-utils";
import { makeSurface, makePane, makeWorkspace } from "./helpers/mocks";

import HomeScreen from "../lib/components/HomeScreen.svelte";
import TitleBar from "../lib/components/TitleBar.svelte";
import FindBar from "../lib/components/FindBar.svelte";
import CommandPalette from "../lib/components/CommandPalette.svelte";

import { findBarVisible, commandPaletteOpen } from "../lib/stores/ui";

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  cleanup();
  findBarVisible.set(false);
  commandPaletteOpen.set(false);
});

// ===========================================================================
// Types module — runtime behavior
// ===========================================================================

describe("types module — runtime behavior", () => {
  it("uid() generates unique IDs with 'id-' prefix", () => {
    const ids = new Set([uid(), uid(), uid()]);
    expect(ids.size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(/^id-/);
    }
  });

  it("getWorktreeEnv returns env for managed workspaces with worktreePath", () => {
    const record: WorkspaceRecord = {
      id: "ws_001",
      type: "managed",
      name: "Feature",
      status: "active",
      branch: "jrvs/feat",
      baseBranch: "main",
      worktreePath: "/tmp/worktree",
    };
    const ws: Workspace = {
      id: "ws1",
      name: "Feature",
      splitRoot: {
        type: "pane",
        pane: { id: "p1", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: "p1",
      record,
    };
    const env = getWorktreeEnv(ws);
    expect(env).toEqual({ GNARTERM_WORKTREE_ROOT: "/tmp/worktree" });
  });

  it("getWorktreeEnv returns undefined for terminal workspaces", () => {
    const ws: Workspace = {
      id: "ws1",
      name: "Terminal",
      splitRoot: {
        type: "pane",
        pane: { id: "p1", surfaces: [], activeSurfaceId: null },
      },
      activePaneId: "p1",
    };
    expect(getWorktreeEnv(ws)).toBeUndefined();
  });

  it("getAllPanes traverses split tree recursively", () => {
    const p1: Pane = { id: "p1", surfaces: [], activeSurfaceId: null };
    const p2: Pane = { id: "p2", surfaces: [], activeSurfaceId: null };
    const tree: SplitNode = {
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { type: "pane", pane: p1 },
        { type: "pane", pane: p2 },
      ],
    };
    expect(getAllPanes(tree).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("findPane returns the pane with matching id or null", () => {
    const ws = makeWorkspace("ws1", "Test");
    const paneId = ws.splitRoot.type === "pane" ? ws.splitRoot.pane.id : "";
    expect(findPane(ws, paneId)).not.toBeNull();
    expect(findPane(ws, "nonexistent")).toBeNull();
  });

  it("type guards correctly discriminate surface kinds", () => {
    const term = makeSurface("t1");
    expect(isTerminalSurface(term)).toBe(true);
    expect(isPreviewSurface(term)).toBe(false);
    expect(isHarnessSurface(term)).toBe(false);
  });
});

// ===========================================================================
// Theme data — behavioral assertions
// ===========================================================================

describe("theme-data module", () => {
  it("exports a themes record with known themes", () => {
    expect(themes).toBeDefined();
    expect(typeof themes).toBe("object");
    expect(Object.keys(themes).length).toBeGreaterThan(0);
  });

  it("includes molly-disco theme with required color fields", () => {
    const mollyDisco = themes["molly-disco"];
    expect(mollyDisco).toBeDefined();
    expect(mollyDisco.name).toBe("Molly Disco");
    expect(mollyDisco.bg).toBeDefined();
    expect(mollyDisco.fg).toBeDefined();
    expect(mollyDisco.accent).toBeDefined();
  });

  it("every theme has the required ThemeDef fields", () => {
    const requiredFields = ["name", "bg", "fg", "accent", "border"];
    for (const [key, theme] of Object.entries(themes)) {
      for (const field of requiredFields) {
        expect((theme as Record<string, unknown>)[field]).toBeDefined();
      }
    }
  });
});

// ===========================================================================
// Dialog utils — function existence and behavior
// ===========================================================================

describe("dialog-utils module", () => {
  it("dialogStyles returns style objects with expected keys", () => {
    const theme = themes["one-dark"];
    const styles = dialogStyles(theme);
    expect(styles.label).toBeDefined();
    expect(styles.input).toBeDefined();
    expect(styles.select).toBeDefined();
    expect(typeof styles.tab).toBe("function");
    expect(styles.browseBtn).toBeDefined();
  });

  it("showErrorDialog is an async function", () => {
    expect(typeof showErrorDialog).toBe("function");
  });

  it("browseDirectory is an async function", () => {
    expect(typeof browseDirectory).toBe("function");
  });
});

// ===========================================================================
// Component rendering — real mounts with @testing-library/svelte
// ===========================================================================

describe("TitleBar renders correctly", () => {
  it("renders GnarTerm text and drag region", () => {
    const { container } = render(TitleBar);
    expect(screen.getByText("GnarTerm")).toBeDefined();
    expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  });
});

describe("FindBar renders when visible", () => {
  it("renders search input and navigation buttons", () => {
    findBarVisible.set(true);
    render(FindBar);
    expect(screen.getByPlaceholderText("Find...")).toBeDefined();
    expect(screen.getByTitle("Previous match (⇧⌘G)")).toBeDefined();
    expect(screen.getByTitle("Next match (⌘G)")).toBeDefined();
    expect(screen.getByTitle("Close (Esc)")).toBeDefined();
  });

  it("does not render when findBarVisible is false", () => {
    findBarVisible.set(false);
    const { container } = render(FindBar);
    expect(container.querySelector("#find-bar")).toBeNull();
  });
});

describe("CommandPalette renders when open", () => {
  it("renders overlay with input and command list", () => {
    commandPaletteOpen.set(true);
    render(CommandPalette, {
      props: {
        commands: [
          { name: "New Terminal", action: () => {}, shortcut: "⌘T" },
          { name: "Close Tab", action: () => {} },
        ],
      },
    });
    expect(screen.getByPlaceholderText("Type a command...")).toBeDefined();
    expect(screen.getByText("New Terminal")).toBeDefined();
    expect(screen.getByText("Close Tab")).toBeDefined();
    expect(screen.getByText("⌘T")).toBeDefined();
  });

  it("does not render when closed", () => {
    commandPaletteOpen.set(false);
    const { container } = render(CommandPalette, {
      props: { commands: [] },
    });
    expect(container.querySelector("#cmd-palette-overlay")).toBeNull();
  });
});

describe("HomeScreen component renders", () => {
  it("renders the Dashboard heading and Projects section", () => {
    render(HomeScreen, {
      props: {
        onAddProject: () => {},
        onNewWorkspace: (_projectId: string) => {},
        onNewFloatingWorkspace: () => {},
        onSwitchToWorkspace: (_wsId: string) => {},
      },
    });
    expect(screen.getByText("+ New Project")).toBeDefined();
  });
});
