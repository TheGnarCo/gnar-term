/**
 * Shared mock setup and factory helpers for tests.
 *
 * Centralizes the xterm Terminal mock (~50 lines of vi.fn() calls) and
 * common surface/pane/workspace factory functions so each test file
 * does not need to maintain its own copy.
 */
import { vi } from "vitest";
import type {
  Workspace,
  Pane,
  TerminalSurface,
  HarnessSurface,
  AgentStatus,
} from "../../lib/types";

// ---------------------------------------------------------------------------
// xterm mock setup — call once per test file before component imports
// ---------------------------------------------------------------------------

/**
 * Registers vi.mock() calls for all xterm packages plus common Tauri APIs.
 *
 * IMPORTANT: This must be called at the top level of a test file (not inside
 * describe/it blocks) because vi.mock is hoisted.
 *
 * Since vi.mock is hoisted by vitest, callers should still declare their own
 * vi.mock calls. This function exists as documentation/reference for the
 * canonical mock shape. The actual mocks are applied via vi.mock() calls at
 * module scope in each test file — they cannot be dynamically registered
 * from a helper due to hoisting.
 */

// Instead of a setup function (which can't work with vi.mock hoisting),
// we export the mock implementation objects for reuse.

export const xtermTerminalMock = () => ({
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
});

export const xtermFitAddonMock = () => ({
  fit: vi.fn(),
  activate: vi.fn(),
  dispose: vi.fn(),
});

export const xtermWebglAddonMock = () => ({
  activate: vi.fn(),
  dispose: vi.fn(),
  onContextLoss: vi.fn(),
});

export const xtermWebLinksAddonMock = () => ({
  activate: vi.fn(),
  dispose: vi.fn(),
});

export const xtermSearchAddonMock = () => ({
  activate: vi.fn(),
  dispose: vi.fn(),
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  clearDecorations: vi.fn(),
});

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock TerminalSurface with sensible defaults.
 * Override any field via the `overrides` parameter.
 */
export function makeSurface(
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

/**
 * Create a mock Pane containing the given surfaces (or a default one).
 */
export function makePane(id: string, surfaces?: TerminalSurface[]): Pane {
  const s = surfaces ?? [makeSurface(`${id}-s1`)];
  return {
    id,
    surfaces: s,
    activeSurfaceId: s[0].id,
  };
}

/**
 * Create a mock Workspace with a single pane (or the provided one).
 */
export function makeWorkspace(
  id: string,
  name: string,
  pane?: Pane,
): Workspace {
  const p = pane ?? makePane(`${id}-p1`);
  return {
    id,
    name,
    splitRoot: { type: "pane", pane: p },
    activePaneId: p.id,
  };
}

/**
 * Create a mock HarnessSurface with sensible defaults.
 */
export function makeHarnessSurface(
  id: string,
  overrides: Partial<HarnessSurface> = {},
): HarnessSurface {
  return {
    kind: "harness",
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
    ptyId: 2,
    title: `Harness ${id}`,
    hasUnread: false,
    opened: true,
    presetId: "claude",
    status: "idle" as AgentStatus,
    ...overrides,
  };
}
