/**
 * Tests for attention-api.ts — reactive Attention API derived from
 * AgentState transitions (cycle-4) and OSC notifications (cycle-2).
 *
 * TDD: written before implementation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  attentionStore,
  dismissAttention,
  pushExternalAttention,
  initAttentionApi,
  destroyAttentionApi,
  resetAttentionApiForTests,
  _testHelpers,
} from "../lib/services/attention-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetAttentionApiForTests();
});

// ---------------------------------------------------------------------------
// State machine transitions → events
// ---------------------------------------------------------------------------

describe("attentionStore — AgentState transitions", () => {
  it("running → awaiting_input produces an attention event", () => {
    initAttentionApi();

    _testHelpers.simulateStateEntry("pane-1", "awaiting_input");

    const events = get(attentionStore);
    expect(events.length).toBeGreaterThan(0);
    const ev = events.find((e) => e.paneId === "pane-1");
    expect(ev).toBeDefined();
    expect(ev?.kind).toBe("awaiting_input");
    expect(ev?.source).toBe("agent-state");
  });

  it("running → running does NOT produce an event", () => {
    initAttentionApi();

    _testHelpers.simulateStateEntry("pane-2", "running");

    const events = get(attentionStore).filter((e) => e.paneId === "pane-2");
    expect(events.length).toBe(0);
  });

  it("running → errored produces an event with kind 'errored'", () => {
    initAttentionApi();

    _testHelpers.simulateStateEntry("pane-3", "errored");

    const events = get(attentionStore).filter((e) => e.paneId === "pane-3");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe("errored");
    expect(events[0]?.source).toBe("agent-state");
  });
});

// ---------------------------------------------------------------------------
// OSC notifications → events
// ---------------------------------------------------------------------------

describe("attentionStore — OSC notifications", () => {
  it("OSC notify notification maps to kind:'notify'", () => {
    initAttentionApi();

    _testHelpers.simulateOscNotification({
      paneId: "pane-osc-1",
      kind: "notify",
      title: "Hello",
      body: "Agent needs input",
    });

    const events = get(attentionStore).filter((e) => e.paneId === "pane-osc-1");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe("notify");
    expect(events[0]?.source).toBe("osc");
    expect(events[0]?.title).toBe("Hello");
    expect(events[0]?.body).toBe("Agent needs input");
  });

  it("OSC error notification maps to kind:'errored'", () => {
    initAttentionApi();

    _testHelpers.simulateOscNotification({
      paneId: "pane-osc-2",
      kind: "error",
      title: "Error",
    });

    const events = get(attentionStore).filter((e) => e.paneId === "pane-osc-2");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe("errored");
    expect(events[0]?.source).toBe("osc");
  });

  it("OSC progress notification maps to kind:'progress'", () => {
    initAttentionApi();

    _testHelpers.simulateOscNotification({
      paneId: "pane-osc-3",
      kind: "progress",
    });

    const events = get(attentionStore).filter((e) => e.paneId === "pane-osc-3");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe("progress");
    expect(events[0]?.source).toBe("osc");
  });

  it("OSC complete notification maps to kind:'completed'", () => {
    initAttentionApi();

    _testHelpers.simulateOscNotification({
      paneId: "pane-osc-4",
      kind: "complete",
    });

    const events = get(attentionStore).filter((e) => e.paneId === "pane-osc-4");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.kind).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// dismissAttention
// ---------------------------------------------------------------------------

describe("dismissAttention", () => {
  it("clears events for the given pane only", () => {
    initAttentionApi();

    _testHelpers.simulateStateEntry("pane-a", "awaiting_input");
    _testHelpers.simulateStateEntry("pane-b", "awaiting_input");

    dismissAttention("pane-a");

    const events = get(attentionStore);
    expect(events.find((e) => e.paneId === "pane-a")).toBeUndefined();
    expect(events.find((e) => e.paneId === "pane-b")).toBeDefined();
  });

  it("other panes are unaffected after dismiss", () => {
    initAttentionApi();

    _testHelpers.simulateStateEntry("pane-x", "awaiting_input");
    _testHelpers.simulateStateEntry("pane-y", "errored");

    dismissAttention("pane-x");

    const remaining = get(attentionStore);
    expect(remaining.filter((e) => e.paneId === "pane-y").length).toBe(1);
    expect(remaining.filter((e) => e.paneId === "pane-x").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pushExternalAttention
// ---------------------------------------------------------------------------

describe("pushExternalAttention", () => {
  it("happy path — adds an event with source defaulting to 'external'", () => {
    initAttentionApi();

    pushExternalAttention({
      paneId: "pane-ext-1",
      kind: "notify",
      title: "External",
    });

    const events = get(attentionStore).filter((e) => e.paneId === "pane-ext-1");
    expect(events.length).toBe(1);
    expect(events[0]?.source).toBe("external");
    expect(events[0]?.kind).toBe("notify");
    expect(events[0]?.title).toBe("External");
  });

  it("explicit source: 'external' is preserved", () => {
    initAttentionApi();

    pushExternalAttention({
      paneId: "pane-ext-2",
      kind: "errored",
      source: "external",
    });

    const events = get(attentionStore).filter((e) => e.paneId === "pane-ext-2");
    expect(events[0]?.source).toBe("external");
  });

  it("createdAt is always set and is a number", () => {
    initAttentionApi();

    pushExternalAttention({ paneId: "pane-ts", kind: "notify" });

    const ev = get(attentionStore).find((e) => e.paneId === "pane-ts");
    expect(typeof ev?.createdAt).toBe("number");
    expect(ev?.createdAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Per-pane LRU cap (50 events per pane, 500 total)
// ---------------------------------------------------------------------------

describe("per-pane LRU cap", () => {
  it("pushing 60 events for one pane retains only the 50 newest", () => {
    initAttentionApi();

    for (let i = 0; i < 60; i++) {
      pushExternalAttention({
        paneId: "pane-lru",
        kind: "notify",
        title: `event-${i}`,
      });
    }

    const events = get(attentionStore).filter((e) => e.paneId === "pane-lru");
    expect(events.length).toBe(50);
    // Newest first: title should be event-59 first
    expect(events[0]?.title).toBe("event-59");
    // The oldest retained should be event-10 (60 - 50 = 10 dropped from front)
    expect(events[49]?.title).toBe("event-10");
  });
});

// ---------------------------------------------------------------------------
// initAttentionApi / destroyAttentionApi lifecycle
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("destroy clears the store", () => {
    initAttentionApi();
    pushExternalAttention({ paneId: "pane-lifecycle", kind: "notify" });
    destroyAttentionApi();
    expect(get(attentionStore).length).toBe(0);
  });

  it("reset clears store and allows fresh init", () => {
    initAttentionApi();
    pushExternalAttention({ paneId: "pane-reset", kind: "notify" });
    resetAttentionApiForTests();
    expect(get(attentionStore).length).toBe(0);
    // Should be callable again without errors
    initAttentionApi();
    expect(get(attentionStore).length).toBe(0);
  });
});
