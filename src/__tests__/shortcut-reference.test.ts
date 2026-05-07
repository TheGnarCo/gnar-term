/**
 * Tests for the keyboard-shortcut reference panel.
 *
 * Coverage:
 *   - The panel renders all section headings and includes the ⌘/ self-reference.
 *   - Workspace vocabulary is correct (no legacy "Branched Workspace" labels).
 *   - When a `Show Keyboard Shortcuts` command is registered with the `⌘/`
 *     shortcut, `executeByShortcut` fires it on a metaKey + "/" event.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import ShortcutReference from "../lib/components/ShortcutReference.svelte";
import {
  registerCommand,
  resetCommands,
  executeByShortcut,
} from "../lib/services/command-registry";

describe("ShortcutReference panel", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the panel with section headings and the title", () => {
    const { getByTestId, getByText, getAllByText } = render(ShortcutReference);
    expect(getByTestId("shortcut-reference")).toBeTruthy();
    expect(getByText("Navigation")).toBeTruthy();
    expect(getByText("Panes")).toBeTruthy();
    expect(getByText("Surfaces")).toBeTruthy();
    expect(getByText("App")).toBeTruthy();
    expect(getAllByText("Keyboard Shortcuts").length).toBeGreaterThanOrEqual(2);
  });

  it("includes the ⌘/ self-reference row in the App section", () => {
    const { getByText } = render(ShortcutReference);
    expect(getByText("⌘/")).toBeTruthy();
  });

  it('uses "Workspace" vocabulary for Workspace shortcuts (Workspace = Root Sidebar Workspace)', () => {
    const { getByText, queryByText } = render(ShortcutReference);
    expect(getByText("New Workspace")).toBeTruthy();
    expect(getByText("Close Workspace")).toBeTruthy();
    expect(queryByText(/^New Branched Workspace$/)).toBeNull();
    expect(queryByText(/^Close Branched Workspace$/)).toBeNull();
  });
});

describe("⌘/ command palette wiring", () => {
  beforeEach(() => {
    resetCommands();
  });

  it("executeByShortcut fires the registered Show Keyboard Shortcuts command on ⌘/", () => {
    const action = vi.fn();
    registerCommand({
      id: "core.show-keyboard-shortcuts",
      title: "Show Keyboard Shortcuts",
      shortcut: "⌘/",
      action,
      source: "core",
    });
    const e = {
      key: "/",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(executeByShortcut(e)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not fire on bare /", () => {
    const action = vi.fn();
    registerCommand({
      id: "core.show-keyboard-shortcuts",
      title: "Show Keyboard Shortcuts",
      shortcut: "⌘/",
      action,
      source: "core",
    });
    const e = {
      key: "/",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(executeByShortcut(e)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});

describe("⌘⇧]/[ shifted-bracket surface cycling shortcuts", () => {
  beforeEach(() => {
    resetCommands();
  });

  it("fires next-surface when e.key is } (shifted ] on mac)", () => {
    const action = vi.fn();
    registerCommand({
      id: "core.next-surface",
      title: "Next Surface",
      shortcut: "⌘⇧]",
      action,
      source: "core",
    });
    const e = {
      key: "}",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(executeByShortcut(e)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires prev-surface when e.key is { (shifted [ on mac)", () => {
    const action = vi.fn();
    registerCommand({
      id: "core.prev-surface",
      title: "Previous Surface",
      shortcut: "⌘⇧[",
      action,
      source: "core",
    });
    const e = {
      key: "{",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(executeByShortcut(e)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires next-surface on Ctrl+Shift+] (linux) with e.key }", () => {
    const action = vi.fn();
    registerCommand({
      id: "core.next-surface",
      title: "Next Surface",
      shortcut: "Ctrl+Shift+]",
      action,
      source: "core",
    });
    const e = {
      key: "}",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(executeByShortcut(e)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });

  it("fires prev-surface on Ctrl+Shift+[ (linux) with e.key {", () => {
    const action = vi.fn();
    registerCommand({
      id: "core.prev-surface",
      title: "Previous Surface",
      shortcut: "Ctrl+Shift+[",
      action,
      source: "core",
    });
    const e = {
      key: "{",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    expect(executeByShortcut(e)).toBe(true);
    expect(action).toHaveBeenCalledOnce();
  });
});
