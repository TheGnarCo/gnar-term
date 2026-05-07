import { describe, it, expect, vi, beforeEach } from "vitest";

// The event bus is a singleton, so we re-import for each test via dynamic import
// to get a fresh instance. Instead, we test the class behavior directly.
// Since eventBus is a module-level singleton, we'll use it directly and
// rely on off() for cleanup.

import {
  eventBus,
  type AppEvent,
  type AppEventType,
} from "../lib/services/event-bus";

describe("EventBus", () => {
  // Track handlers for cleanup
  const registeredHandlers: Array<{
    event: AppEventType;
    handler: (e: AppEvent) => void;
  }> = [];

  function trackOn(event: AppEventType, handler: (e: AppEvent) => void) {
    eventBus.on(event, handler);
    registeredHandlers.push({ event, handler });
  }

  beforeEach(() => {
    // Clean up any handlers from previous tests
    for (const { event, handler } of registeredHandlers) {
      eventBus.off(event, handler);
    }
    registeredHandlers.length = 0;
  });

  it("delivers events to subscribed handlers", () => {
    const handler = vi.fn();
    trackOn("workspace:created", handler);

    eventBus.emit({ type: "workspace:created", id: "ws-1", name: "Test" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: "workspace:created",
      id: "ws-1",
      name: "Test",
    });
  });

  it("does not deliver events to handlers for different event types", () => {
    const handler = vi.fn();
    trackOn("workspace:created", handler);

    eventBus.emit({ type: "workspace:closed", id: "ws-1" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to multiple handlers on the same event type", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    trackOn("pane:closed", handler1);
    trackOn("pane:closed", handler2);

    eventBus.emit({ type: "pane:closed", id: "p-1", workspaceId: "ws-1" });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("does not throw when emitting with no handlers", () => {
    expect(() => {
      eventBus.emit({
        type: "workspace:renamed",
        id: "ws-1",
        oldName: "A",
        newName: "B",
      });
    }).not.toThrow();
  });

  it("removes handler via off() so it no longer fires", () => {
    const handler = vi.fn();
    trackOn("theme:changed", handler);

    eventBus.emit({ type: "theme:changed", id: "dark", previousId: "light" });
    expect(handler).toHaveBeenCalledOnce();

    eventBus.off("theme:changed", handler);
    // Remove from our tracking too since we manually off'd
    const idx = registeredHandlers.findIndex((h) => h.handler === handler);
    if (idx >= 0) registeredHandlers.splice(idx, 1);

    eventBus.emit({ type: "theme:changed", id: "mocha", previousId: "dark" });
    expect(handler).toHaveBeenCalledOnce(); // still 1, not 2
  });

  it("isolates errors — one handler throwing does not prevent others from receiving the event", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const badHandler = vi.fn(() => {
      throw new Error("handler boom");
    });
    const goodHandler = vi.fn();

    trackOn("surface:created", badHandler);
    trackOn("surface:created", goodHandler);

    eventBus.emit({
      type: "surface:created",
      id: "s-1",
      paneId: "p-1",
      kind: "terminal",
    });

    expect(badHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error in handler for surface:created"),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("off() for a non-registered handler is a no-op", () => {
    const handler = vi.fn();
    // Should not throw
    expect(() => eventBus.off("workspace:created", handler)).not.toThrow();
  });

  it("delivers correct typed payload for each event type", () => {
    const handler = vi.fn();
    trackOn("pane:split", handler);

    const event: AppEvent = {
      type: "pane:split",
      parentPaneId: "p-1",
      newPaneId: "p-2",
      direction: "horizontal",
    };
    eventBus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("handles subscribe and unsubscribe in rapid succession", () => {
    const handler = vi.fn();
    eventBus.on("sidebar:toggled", handler);
    eventBus.off("sidebar:toggled", handler);

    eventBus.emit({ type: "sidebar:toggled", which: "primary", visible: true });

    expect(handler).not.toHaveBeenCalled();
  });
});
