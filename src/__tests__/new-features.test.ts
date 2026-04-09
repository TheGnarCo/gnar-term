/**
 * Behavioral tests for features: Molly Disco theme, type guards,
 * platform detection exports, and drag-drop shell escaping.
 *
 * Replaces former source-scanning tests with real module imports.
 */

import { describe, it, expect, vi } from "vitest";

// Mock Tauri APIs (needed by terminal-service imports)
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

// ---------------------------------------------------------------------------
// Source imports (after mocks)
// ---------------------------------------------------------------------------

import { themes } from "../lib/theme-data";
import { isMac, modLabel, shiftModLabel } from "../lib/terminal-service";
import {
  isTerminalSurface,
  isPreviewSurface,
  isHarnessSurface,
  isDiffSurface,
  isFileBrowserSurface,
  isCommitHistorySurface,
  type Surface,
  type DiffSurface,
  type FileBrowserSurface,
  type CommitHistorySurface,
} from "../lib/types";

// ===========================================================================
// Molly Disco theme
// ===========================================================================

describe("Molly Disco theme", () => {
  it("is registered in themes with correct name", () => {
    const mollyDisco = themes["molly-disco"];
    expect(mollyDisco).toBeDefined();
    expect(mollyDisco.name).toBe("Molly Disco");
  });

  it("has distinct ANSI colors (vibrant palette)", () => {
    const mollyDisco = themes["molly-disco"];
    // Verify it has ansi property with color fields
    expect(mollyDisco.ansi).toBeDefined();
    // Verify all 16 ANSI color fields are hex strings
    const colorValues = Object.values(mollyDisco.ansi);
    expect(colorValues.length).toBe(16);
    for (const color of colorValues) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("has different colors from the standard Molly theme", () => {
    const molly = themes["molly"];
    const mollyDisco = themes["molly-disco"];
    expect(molly).toBeDefined();
    expect(mollyDisco).toBeDefined();
    // At least one accent or ansi color should differ
    expect(mollyDisco.accent).not.toBe(molly.accent);
  });
});

// ===========================================================================
// Platform detection exports
// ===========================================================================

describe("Platform detection", () => {
  it("exports isMac as a boolean", () => {
    expect(typeof isMac).toBe("boolean");
  });

  it("exports modLabel as a string", () => {
    expect(typeof modLabel).toBe("string");
    // Should be either Cmd or Ctrl symbol
    expect(["⌘", "Ctrl+"]).toContain(modLabel);
  });

  it("exports shiftModLabel as a string", () => {
    expect(typeof shiftModLabel).toBe("string");
    expect(["⇧⌘", "Ctrl+Shift+"]).toContain(shiftModLabel);
  });
});

// ===========================================================================
// Type guards for new surface types
// ===========================================================================

describe("Surface type guards", () => {
  it("isDiffSurface identifies diff surfaces", () => {
    const diff: DiffSurface = {
      kind: "diff",
      id: "d1",
      title: "Diff",
      worktreePath: "/repo",
      diffContent: "+line",
      hasUnread: false,
    };
    expect(isDiffSurface(diff)).toBe(true);
    expect(isTerminalSurface(diff as unknown as Surface)).toBe(false);
  });

  it("isFileBrowserSurface identifies file browser surfaces", () => {
    const fb: FileBrowserSurface = {
      kind: "filebrowser",
      id: "fb1",
      title: "Files",
      worktreePath: "/repo",
      files: ["src/app.ts"],
      hasUnread: false,
    };
    expect(isFileBrowserSurface(fb)).toBe(true);
    expect(isDiffSurface(fb as unknown as Surface)).toBe(false);
  });

  it("isCommitHistorySurface identifies commit history surfaces", () => {
    const ch: CommitHistorySurface = {
      kind: "commithistory",
      id: "ch1",
      title: "Commits",
      worktreePath: "/repo",
      commits: [],
      hasUnread: false,
    };
    expect(isCommitHistorySurface(ch)).toBe(true);
    expect(isFileBrowserSurface(ch as unknown as Surface)).toBe(false);
  });
});
