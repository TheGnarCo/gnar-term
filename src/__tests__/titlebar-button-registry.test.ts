import { describe, it, expect, beforeEach } from "vitest";
import { get, readable } from "svelte/store";
import {
  titleBarButtonStore,
  registerTitleBarButton,
  unregisterTitleBarButtonsBySource,
  resetTitleBarButtons,
} from "../lib/services/titlebar-button-registry";

const noop = () => {};
const makeButton = (id: string, source: string) => ({
  id,
  source,
  icon: null as unknown,
  title: `Button ${id}`,
  onClick: noop,
});

describe("titlebar-button-registry", () => {
  beforeEach(() => {
    resetTitleBarButtons();
  });

  it("starts empty", () => {
    expect(get(titleBarButtonStore)).toEqual([]);
  });

  it("registers a button", () => {
    registerTitleBarButton(makeButton("ext-a:btn1", "ext-a"));
    const buttons = get(titleBarButtonStore);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].id).toBe("ext-a:btn1");
    expect(buttons[0].title).toBe("Button ext-a:btn1");
  });

  it("replaces a button with the same id", () => {
    registerTitleBarButton(makeButton("ext-a:btn1", "ext-a"));
    registerTitleBarButton({
      ...makeButton("ext-a:btn1", "ext-a"),
      title: "Updated",
    });
    const buttons = get(titleBarButtonStore);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].title).toBe("Updated");
  });

  it("unregisterTitleBarButtonsBySource removes all buttons from source", () => {
    registerTitleBarButton(makeButton("ext-a:btn1", "ext-a"));
    registerTitleBarButton(makeButton("ext-a:btn2", "ext-a"));
    registerTitleBarButton(makeButton("ext-b:btn1", "ext-b"));
    unregisterTitleBarButtonsBySource("ext-a");
    const buttons = get(titleBarButtonStore);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].source).toBe("ext-b");
  });

  it("is a no-op when unregistering unknown source", () => {
    registerTitleBarButton(makeButton("ext-a:btn1", "ext-a"));
    unregisterTitleBarButtonsBySource("unknown");
    expect(get(titleBarButtonStore)).toHaveLength(1);
  });

  it("stores isActive store reference on the button", () => {
    const isActive = readable(true);
    registerTitleBarButton({ ...makeButton("ext-a:btn1", "ext-a"), isActive });
    const btn = get(titleBarButtonStore)[0];
    expect(btn.isActive).toBe(isActive);
  });
});
