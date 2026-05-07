import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted runs before module imports — inline a minimal writable-like store
// so the vi.mock factory below can reference it without a TDZ error.
const _hintsActive = vi.hoisted(() => {
  let _value = false;
  const _subs = new Set<(v: boolean) => void>();
  return {
    subscribe(fn: (v: boolean) => void) {
      _subs.add(fn);
      fn(_value);
      return () => _subs.delete(fn);
    },
    set(v: boolean) {
      _value = v;
      _subs.forEach((fn) => fn(v));
    },
  };
});

vi.mock("../lib/stores/shortcut-hints", () => ({
  shortcutHintsActive: { subscribe: _hintsActive.subscribe },
}));

vi.mock("../lib/stores/theme", () => ({
  theme: {
    subscribe: vi.fn((fn: (v: object) => void) => {
      fn({ accent: "#ff0000", bg: "#000000" });
      return () => {};
    }),
  },
}));

import { shortcutHint } from "../lib/actions/shortcut-hint";

function makeNode(): HTMLElement {
  const node = document.createElement("div");
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
    left: 10,
    right: 110,
    top: 20,
    bottom: 40,
    width: 100,
    height: 20,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  } as DOMRect);
  return node;
}

describe("shortcut-hint action", () => {
  beforeEach(() => {
    _hintsActive.set(false);
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends no badge when hints are inactive", () => {
    const node = makeNode();
    shortcutHint(node, "⌘T");
    expect(document.body.children.length).toBe(0);
  });

  it("appends a badge when hints become active", () => {
    const node = makeNode();
    shortcutHint(node, "⌘T");

    _hintsActive.set(true);

    expect(document.body.children.length).toBe(1);
    expect(document.body.children[0].textContent).toBe("⌘T");
  });

  it("removes badge when hints deactivate", () => {
    const node = makeNode();
    shortcutHint(node, "⌘T");

    _hintsActive.set(true);
    expect(document.body.children.length).toBe(1);

    _hintsActive.set(false);
    expect(document.body.children.length).toBe(0);
  });

  it("badge is aria-hidden and pointer-events:none", () => {
    const node = makeNode();
    shortcutHint(node, "⌘T");
    _hintsActive.set(true);

    const badge = document.body.children[0] as HTMLElement;
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge.style.pointerEvents).toBe("none");
  });

  it("appends no badge when label is null", () => {
    const node = makeNode();
    shortcutHint(node, null);
    _hintsActive.set(true);
    expect(document.body.children.length).toBe(0);
  });

  it("appends no badge when label is undefined", () => {
    const node = makeNode();
    shortcutHint(node, undefined);
    _hintsActive.set(true);
    expect(document.body.children.length).toBe(0);
  });

  it("update() changes badge text while hints are active", () => {
    const node = makeNode();
    const action = shortcutHint(node, "⌘T");
    _hintsActive.set(true);

    action.update("⌘B");
    expect(document.body.children[0].textContent).toBe("⌘B");
  });

  it("update() removes badge when new label is null", () => {
    const node = makeNode();
    const action = shortcutHint(node, "⌘T");
    _hintsActive.set(true);

    action.update(null);
    expect(document.body.children.length).toBe(0);
  });

  it("update() shows badge when label becomes truthy during active hints", () => {
    const node = makeNode();
    const action = shortcutHint(node, undefined);
    _hintsActive.set(true);
    expect(document.body.children.length).toBe(0);

    action.update("⌘1");
    expect(document.body.children.length).toBe(1);
    expect(document.body.children[0].textContent).toBe("⌘1");
  });

  it("destroy() removes badge and unsubscribes", () => {
    const node = makeNode();
    const action = shortcutHint(node, "⌘T");
    _hintsActive.set(true);
    expect(document.body.children.length).toBe(1);

    action.destroy();
    expect(document.body.children.length).toBe(0);

    // After destroy, re-activating hints must not bring the badge back
    _hintsActive.set(false);
    _hintsActive.set(true);
    expect(document.body.children.length).toBe(0);
  });

  it("does not duplicate badge on repeated active signals", () => {
    const node = makeNode();
    shortcutHint(node, "⌘T");

    _hintsActive.set(true);
    _hintsActive.set(true);
    expect(document.body.children.length).toBe(1);
  });
});
