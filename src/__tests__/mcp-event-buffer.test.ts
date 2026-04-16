import { describe, it, expect, beforeEach } from "vitest";
import {
  pushEvent,
  pollEvents,
  _resetEventBufferForTest,
  getEventBufferSizeForTest,
} from "../lib/services/mcp-event-buffer";

describe("mcp-event-buffer", () => {
  beforeEach(() => _resetEventBufferForTest());

  it("returns empty when no events", () => {
    const r = pollEvents();
    expect(r.events).toEqual([]);
    expect(r.truncated).toBeUndefined();
  });

  it("assigns monotonically increasing cursors", () => {
    pushEvent({ type: "workspace.changed", workspaceId: "ws-1" });
    pushEvent({ type: "workspace.changed", workspaceId: "ws-2" });
    const r = pollEvents();
    expect(r.events.map((e) => e.cursor)).toEqual([1, 2]);
    expect(r.cursor).toBe(2);
  });

  it("returns only events after the caller cursor", () => {
    pushEvent({ type: "workspace.changed", workspaceId: "ws-1" });
    pushEvent({ type: "workspace.changed", workspaceId: "ws-2" });
    pushEvent({ type: "workspace.changed", workspaceId: "ws-3" });
    const r = pollEvents({ cursor: 1 });
    expect(r.events).toHaveLength(2);
    expect(r.events[0].cursor).toBe(2);
  });

  it("respects the ring buffer size of 500", () => {
    for (let i = 0; i < 600; i++) {
      pushEvent({ type: "workspace.changed", workspaceId: `w-${i}` });
    }
    expect(getEventBufferSizeForTest()).toBe(500);
    const r = pollEvents({ cursor: 0, max: 500 });
    // Oldest retained cursor is 101 (1..100 dropped).
    expect(r.events[0].cursor).toBe(101);
    expect(r.truncated).toBe(true);
  });

  it("caps max results", () => {
    for (let i = 0; i < 20; i++) {
      pushEvent({ type: "workspace.changed", workspaceId: `w-${i}` });
    }
    const r = pollEvents({ max: 5 });
    expect(r.events).toHaveLength(5);
  });

  it("supports sidebar.item_clicked events", () => {
    pushEvent({
      type: "sidebar.item_clicked",
      side: "secondary",
      sectionId: "cwd-file-navigator",
      itemId: "README.md",
    });
    const r = pollEvents();
    expect(r.events[0]).toMatchObject({
      type: "sidebar.item_clicked",
      side: "secondary",
      sectionId: "cwd-file-navigator",
      itemId: "README.md",
    });
  });

  it("reports the latest cursor when caller is already caught up", () => {
    pushEvent({ type: "workspace.changed", workspaceId: "w1" });
    pushEvent({ type: "workspace.changed", workspaceId: "w2" });
    const r = pollEvents({ cursor: 2 });
    expect(r.events).toHaveLength(0);
    expect(r.cursor).toBe(2);
  });
});
