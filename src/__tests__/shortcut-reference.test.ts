/**
 * Tests for the keyboard-shortcut reference overlay (S6).
 *
 * Coverage:
 *   - The component renders nothing when `open` is false and a dialog when
 *     `open` is true. Backdrop click and Escape both close it.
 *   - When a `Show Keyboard Shortcuts` command is registered with the `⌘/`
 *     shortcut, `executeByShortcut` fires it on a metaKey + "/" event so the
 *     command-palette wiring used in App.svelte routes correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import ShortcutReference from "../lib/components/ShortcutReference.svelte";
import ShortcutReferenceHarness from "./shortcut-reference-harness.svelte";
import {
  registerCommand,
  resetCommands,
  executeByShortcut,
} from "../lib/services/command-registry";

describe("ShortcutReference component", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders nothing when open is false", () => {
    const { queryByTestId } = render(ShortcutReference, {
      props: { open: false },
    });
    expect(queryByTestId("shortcut-reference")).toBeNull();
  });

  it("renders the dialog when open is true", () => {
    const { getByRole, getByText } = render(ShortcutReference, {
      props: { open: true },
    });
    expect(getByRole("dialog")).toBeTruthy();
    // Section headings for every category.
    expect(getByText("Navigation")).toBeTruthy();
    expect(getByText("Panes")).toBeTruthy();
    expect(getByText("Surfaces (Terminals)")).toBeTruthy();
    expect(getByText("App")).toBeTruthy();
  });

  it("includes the ⌘/ self-reference row in the App section", () => {
    const { getAllByText, getByText } = render(ShortcutReference, {
      props: { open: true },
    });
    // Both the dialog title and the App-section row have this label.
    expect(getAllByText("Keyboard Shortcuts").length).toBeGreaterThanOrEqual(2);
    expect(getByText("⌘/")).toBeTruthy();
  });

  it("closes when Escape is pressed", async () => {
    const { getByTestId, queryByTestId } = render(ShortcutReferenceHarness, {
      props: { open: true },
    });
    const overlay = getByTestId("shortcut-reference");
    await fireEvent.keyDown(overlay, { key: "Escape" });
    // bind:open in the harness flips back to false; the modal unmounts.
    expect(queryByTestId("shortcut-reference")).toBeNull();
  });

  it("closes when the backdrop is clicked", async () => {
    const { getByTestId, queryByTestId } = render(ShortcutReferenceHarness, {
      props: { open: true },
    });
    const overlay = getByTestId("shortcut-reference");
    await fireEvent.mouseDown(overlay);
    expect(queryByTestId("shortcut-reference")).toBeNull();
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
