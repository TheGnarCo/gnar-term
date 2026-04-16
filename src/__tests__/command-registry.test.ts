/**
 * Tests for command-registry — command palette registration.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  registerCommand,
  registerCommands,
  unregisterBySource,
  resetCommands,
  commandStore,
  executeByShortcut,
  type Command,
} from "../lib/services/command-registry";

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "test-cmd",
    title: "Test Command",
    action: () => {},
    source: "core",
    ...overrides,
  };
}

describe("command-registry", () => {
  beforeEach(() => {
    resetCommands();
  });

  it("starts empty", () => {
    expect(get(commandStore)).toEqual([]);
  });

  it("registers a single command", () => {
    const cmd = makeCommand({ id: "open-terminal", title: "Open Terminal" });
    registerCommand(cmd);
    const items = get(commandStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("open-terminal");
    expect(items[0].title).toBe("Open Terminal");
  });

  it("registers multiple commands via registerCommands", () => {
    registerCommands([
      makeCommand({ id: "cmd-a", title: "A" }),
      makeCommand({ id: "cmd-b", title: "B" }),
      makeCommand({ id: "cmd-c", title: "C" }),
    ]);
    expect(get(commandStore)).toHaveLength(3);
  });

  it("replaces a command with the same id", () => {
    registerCommand(makeCommand({ id: "dup", title: "First" }));
    registerCommand(makeCommand({ id: "dup", title: "Second" }));
    const items = get(commandStore);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Second");
  });

  it("unregisters all commands by source", () => {
    registerCommands([
      makeCommand({ id: "ext-a", source: "ext-1" }),
      makeCommand({ id: "ext-b", source: "ext-1" }),
      makeCommand({ id: "core-a", source: "core" }),
    ]);
    unregisterBySource("ext-1");
    const items = get(commandStore);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("core-a");
  });

  it("resets to empty", () => {
    registerCommands([makeCommand({ id: "a" }), makeCommand({ id: "b" })]);
    resetCommands();
    expect(get(commandStore)).toEqual([]);
  });

  it("preserves shortcut property", () => {
    registerCommand(makeCommand({ id: "zoom", shortcut: "Cmd+=" }));
    expect(get(commandStore)[0].shortcut).toBe("Cmd+=");
  });

  it("action is callable", () => {
    let called = false;
    registerCommand(
      makeCommand({
        id: "act",
        action: () => {
          called = true;
        },
      }),
    );
    get(commandStore)[0].action();
    expect(called).toBe(true);
  });
});

function makeKeyboardEvent(
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent;
}

describe("executeByShortcut", () => {
  beforeEach(() => {
    resetCommands();
  });

  it("matches Mac symbol shortcut (⇧⌘N)", () => {
    const action = vi.fn();
    registerCommand(makeCommand({ id: "new-ws", shortcut: "⇧⌘N", action }));
    const e = makeKeyboardEvent({
      key: "n",
      metaKey: true,
      shiftKey: true,
    });
    const result = executeByShortcut(e);
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it("matches Ctrl+Shift+N format", () => {
    const action = vi.fn();
    registerCommand(
      makeCommand({ id: "new-ws", shortcut: "Ctrl+Shift+N", action }),
    );
    const e = makeKeyboardEvent({
      key: "N",
      ctrlKey: true,
      shiftKey: true,
    });
    const result = executeByShortcut(e);
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it("returns false for non-matching event", () => {
    const action = vi.fn();
    registerCommand(makeCommand({ id: "new-ws", shortcut: "⇧⌘N", action }));
    const e = makeKeyboardEvent({
      key: "t",
      metaKey: true,
      shiftKey: true,
    });
    const result = executeByShortcut(e);
    expect(result).toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it("does not match when modifier keys differ", () => {
    const action = vi.fn();
    registerCommand(makeCommand({ id: "new-ws", shortcut: "⇧⌘N", action }));
    const e = makeKeyboardEvent({
      key: "n",
      metaKey: true,
      shiftKey: false,
    });
    expect(executeByShortcut(e)).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("returns false when no commands are registered", () => {
    const e = makeKeyboardEvent({ key: "n", metaKey: true, shiftKey: true });
    expect(executeByShortcut(e)).toBe(false);
  });
});
