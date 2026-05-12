/**
 * Tests for osc-notification-service.ts
 *
 * Covers:
 *  - Happy-path parsing for OSC 9, 9;4, 99, 777
 *  - Malformed-input silent-drop for each sequence type
 *  - Multiple sequences in one chunk → multiple events
 *  - OSC 9;4 progress states 0, 1, 2, 3, 4
 *  - cmux-semantic key mapping for OSC 99
 *  - Store eviction past cap of 200
 *  - Both BEL (\x07) and ST (\x1b\\) terminators
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  parseOscNotification,
  feedPaneOutput,
  oscNotificationStore,
  resetOscNotificationStoreForTests,
} from "../lib/services/osc-notification-service";

beforeEach(() => {
  resetOscNotificationStoreForTests();
});

// ---------------------------------------------------------------------------
// parseOscNotification — OSC 9
// ---------------------------------------------------------------------------

describe("OSC 9 — generic notification", () => {
  it("parses a BEL-terminated OSC 9 body", () => {
    const result = parseOscNotification("p1", "\x1b]9;Hello world\x07");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "notify",
      body: "Hello world",
    });
    expect(result[0].title).toBeUndefined();
  });

  it("parses a ST-terminated OSC 9 body", () => {
    const result = parseOscNotification("p1", "\x1b]9;Hello ST\x1b\\");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "notify",
      body: "Hello ST",
    });
  });

  it("treats cmux-semantic prefix as OSC 99 delegation", () => {
    // body starting with "cmux-semantic:" → parsed as OSC 99 keys inline
    const result = parseOscNotification(
      "p1",
      "\x1b]9;cmux-semantic:kind=complete;title=Done;body=All tasks finished\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "complete",
      title: "Done",
      body: "All tasks finished",
    });
  });

  it("drops malformed OSC 9 with no body separator", () => {
    // Missing the value after "9;"
    const result = parseOscNotification("p1", "\x1b]9\x07");
    expect(result).toHaveLength(0);
  });

  it("drops a completely empty OSC sequence", () => {
    const result = parseOscNotification("p1", "\x1b]\x07");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseOscNotification — OSC 9;4 progress
// ---------------------------------------------------------------------------

describe("OSC 9;4 — progress/state notification", () => {
  it("state 1 (default) → kind: progress with progress field", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;1;42\x07");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "progress",
      progress: 42,
    });
    expect(result[0].level).toBeUndefined();
  });

  it("state 2 (error) → kind: error", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;2;75\x07");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "error",
      progress: 75,
    });
  });

  it("state 3 (indeterminate) → kind: progress without progress field", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;3;0\x07");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ paneId: "p1", kind: "progress" });
    expect(result[0].progress).toBeUndefined();
  });

  it("state 4 (warning) → kind: progress, level: warn", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;4;60\x07");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "progress",
      level: "warn",
      progress: 60,
    });
  });

  it("state 0 (clear) → no event emitted", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;0;0\x07");
    expect(result).toHaveLength(0);
  });

  it("clamps progress to 0–100", () => {
    const high = parseOscNotification("p1", "\x1b]9;4;1;150\x07");
    expect(high[0].progress).toBe(100);
    const low = parseOscNotification("p1", "\x1b]9;4;1;-10\x07");
    expect(low[0].progress).toBe(0);
  });

  it("drops malformed OSC 9;4 with missing state field", () => {
    const result = parseOscNotification("p1", "\x1b]9;4\x07");
    expect(result).toHaveLength(0);
  });

  it("drops malformed OSC 9;4 with non-numeric state", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;abc;50\x07");
    expect(result).toHaveLength(0);
  });

  it("ST terminator works for OSC 9;4", () => {
    const result = parseOscNotification("p1", "\x1b]9;4;1;55\x1b\\");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "progress", progress: 55 });
  });
});

// ---------------------------------------------------------------------------
// parseOscNotification — OSC 99 (cmux-semantic)
// ---------------------------------------------------------------------------

describe("OSC 99 — cmux-semantic notifications", () => {
  it("parses kind=notify with title and body", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]99;kind=notify;title=Test;body=Hello\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "notify",
      title: "Test",
      body: "Hello",
    });
  });

  it("parses kind=complete", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]99;kind=complete;title=Done\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "complete", title: "Done" });
  });

  it("parses kind=error with level", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]99;kind=error;level=error;body=Something failed\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "error",
      level: "error",
      body: "Something failed",
    });
  });

  it("parses level=warn on a notify", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]99;kind=notify;level=warn;body=Warning\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "notify", level: "warn" });
  });

  it("drops malformed OSC 99 with no key=value pairs", () => {
    const result = parseOscNotification("p1", "\x1b]99;\x07");
    expect(result).toHaveLength(0);
  });

  it("drops OSC 99 with no recognised kind value", () => {
    const result = parseOscNotification("p1", "\x1b]99;kind=bogus;title=X\x07");
    expect(result).toHaveLength(0);
  });

  it("ST terminator works for OSC 99", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]99;kind=notify;body=Hi\x1b\\",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "notify", body: "Hi" });
  });
});

// ---------------------------------------------------------------------------
// parseOscNotification — OSC 777
// ---------------------------------------------------------------------------

describe("OSC 777 — urxvt notify", () => {
  it("parses notify;<title>;<body> format", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]777;notify;Build done;All tests passed\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paneId: "p1",
      kind: "notify",
      title: "Build done",
      body: "All tests passed",
    });
  });

  it("parses notify with empty body", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]777;notify;Just a title;\x07",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "notify",
      title: "Just a title",
      body: "",
    });
  });

  it("drops malformed OSC 777 that isn't notify subcommand", () => {
    const result = parseOscNotification("p1", "\x1b]777;unknown;foo;bar\x07");
    expect(result).toHaveLength(0);
  });

  it("drops malformed OSC 777 with missing title/body fields", () => {
    const result = parseOscNotification("p1", "\x1b]777;notify\x07");
    expect(result).toHaveLength(0);
  });

  it("ST terminator works for OSC 777", () => {
    const result = parseOscNotification(
      "p1",
      "\x1b]777;notify;Title;Body\x1b\\",
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "notify",
      title: "Title",
      body: "Body",
    });
  });
});

// ---------------------------------------------------------------------------
// Multiple sequences in a single chunk
// ---------------------------------------------------------------------------

describe("multiple sequences in one chunk", () => {
  it("returns an event for each valid sequence", () => {
    const chunk =
      "\x1b]9;First notification\x07" +
      "some junk output\n" +
      "\x1b]777;notify;Title;Body\x07" +
      "\x1b]99;kind=complete;title=Done\x07";
    const result = parseOscNotification("p1", chunk);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      kind: "notify",
      body: "First notification",
    });
    expect(result[1]).toMatchObject({
      kind: "notify",
      title: "Title",
      body: "Body",
    });
    expect(result[2]).toMatchObject({ kind: "complete", title: "Done" });
  });

  it("skips malformed sequences but still returns valid ones", () => {
    const chunk =
      "\x1b]9;Valid\x07" +
      "\x1b]777;unknown;bad;data\x07" +
      "\x1b]99;kind=notify;body=Also valid\x07";
    const result = parseOscNotification("p1", chunk);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ body: "Valid" });
    expect(result[1]).toMatchObject({ body: "Also valid" });
  });
});

// ---------------------------------------------------------------------------
// feedPaneOutput and oscNotificationStore
// ---------------------------------------------------------------------------

describe("feedPaneOutput → oscNotificationStore", () => {
  it("appends events to the store", () => {
    feedPaneOutput("p1", "\x1b]9;Hello\x07");
    const stored = get(oscNotificationStore);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      paneId: "p1",
      kind: "notify",
      body: "Hello",
    });
  });

  it("accumulates across multiple calls", () => {
    feedPaneOutput("p1", "\x1b]9;A\x07");
    feedPaneOutput("p2", "\x1b]9;B\x07");
    const stored = get(oscNotificationStore);
    expect(stored).toHaveLength(2);
  });

  it("evicts oldest entries when exceeding cap of 200", () => {
    // Fill to 200
    for (let i = 0; i < 200; i++) {
      feedPaneOutput("p1", `\x1b]9;msg-${i}\x07`);
    }
    expect(get(oscNotificationStore)).toHaveLength(200);
    // One more should evict the oldest
    feedPaneOutput("p1", "\x1b]9;msg-overflow\x07");
    const stored = get(oscNotificationStore);
    expect(stored).toHaveLength(200);
    expect(stored[stored.length - 1].body).toBe("msg-overflow");
    expect(stored[0].body).toBe("msg-1"); // msg-0 was evicted
  });

  it("does not throw on chunks with no OSC sequences", () => {
    expect(() =>
      feedPaneOutput("p1", "plain terminal output\r\n"),
    ).not.toThrow();
    expect(get(oscNotificationStore)).toHaveLength(0);
  });

  it("does not throw on empty string", () => {
    expect(() => feedPaneOutput("p1", "")).not.toThrow();
    expect(get(oscNotificationStore)).toHaveLength(0);
  });
});
