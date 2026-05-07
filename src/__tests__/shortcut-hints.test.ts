import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/terminal-service", () => ({
  isMac: true,
  modLabel: "⌘",
  shiftModLabel: "⇧⌘",
}));

// Capture window listeners so we can fire them manually
type Listener = (e: Event) => void;
const listeners: Record<string, Listener[]> = {};

vi.stubGlobal("window", {
  addEventListener: vi.fn((type: string, fn: Listener) => {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
  }),
  removeEventListener: vi.fn((type: string, fn: Listener) => {
    if (listeners[type]) {
      listeners[type] = listeners[type].filter((l) => l !== fn);
    }
  }),
});

function fire(type: string, eventInit: Partial<KeyboardEvent> = {}) {
  const event = Object.assign(
    { type, key: "", repeat: false, preventDefault: vi.fn() },
    eventInit,
  );
  for (const fn of listeners[type] ?? []) fn(event as unknown as Event);
}

describe("shortcut-hints store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset listener registry between tests
    for (const key of Object.keys(listeners)) delete listeners[key];
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function load() {
    const mod = await import("../lib/stores/shortcut-hints");
    return mod;
  }

  it("store starts as false", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();
    expect(get(shortcutHintsActive)).toBe(false);
  });

  it("becomes true after holding modifier for 1.5s", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();

    fire("keydown", { key: "Meta" });
    expect(get(shortcutHintsActive)).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(get(shortcutHintsActive)).toBe(true);
  });

  it("stays false if modifier released before 1s", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();

    fire("keydown", { key: "Meta" });
    vi.advanceTimersByTime(500);
    fire("keyup", { key: "Meta" });
    vi.advanceTimersByTime(1000);

    expect(get(shortcutHintsActive)).toBe(false);
  });

  it("cancels and stays false when any other key is pressed during hold", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();

    fire("keydown", { key: "Meta" });
    vi.advanceTimersByTime(500);
    fire("keydown", { key: "t" });
    vi.advanceTimersByTime(1000);

    expect(get(shortcutHintsActive)).toBe(false);
  });

  it("hides hints on modifier keyup after activation", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();

    fire("keydown", { key: "Meta" });
    vi.advanceTimersByTime(1500);
    expect(get(shortcutHintsActive)).toBe(true);

    fire("keyup", { key: "Meta" });
    expect(get(shortcutHintsActive)).toBe(false);
  });

  it("cancels and hides on window blur", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();

    fire("keydown", { key: "Meta" });
    vi.advanceTimersByTime(1500);
    expect(get(shortcutHintsActive)).toBe(true);

    fire("blur");
    expect(get(shortcutHintsActive)).toBe(false);
  });

  it("ignores repeated keydown events (does not reset timer)", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    initShortcutHints();

    fire("keydown", { key: "Meta" });
    vi.advanceTimersByTime(750);
    // Simulated key-repeat should be ignored
    fire("keydown", { key: "Meta", repeat: true });
    fire("keydown", { key: "Meta", repeat: true });
    vi.advanceTimersByTime(750);

    expect(get(shortcutHintsActive)).toBe(true);
  });

  it("cleanup removes listeners and resets store", async () => {
    const { shortcutHintsActive, initShortcutHints } = await load();
    const cleanup = initShortcutHints();

    fire("keydown", { key: "Meta" });
    vi.advanceTimersByTime(1500);
    expect(get(shortcutHintsActive)).toBe(true);

    cleanup();
    expect(get(shortcutHintsActive)).toBe(false);
    expect(window.removeEventListener).toHaveBeenCalled();
  });
});
