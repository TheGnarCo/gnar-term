import { describe, it, expect } from "vitest";
import { writable, get } from "svelte/store";
import type { ExtensionAPI } from "../../api";
import { attentionPulseStore } from "../stores/attention-pulse";

function makeFakeApi(initialAttention: unknown[] = []) {
  const attention = writable(initialAttention);
  const api = { attention } as unknown as ExtensionAPI;
  return { api, attention };
}

describe("attentionPulseStore", () => {
  it("emits false when attention is empty", () => {
    const { api } = makeFakeApi([]);
    const store = attentionPulseStore(api);
    expect(get(store)).toBe(false);
  });

  it("emits true after a single entry is pushed", () => {
    const { api, attention } = makeFakeApi([]);
    const store = attentionPulseStore(api);
    attention.set([{ paneId: "pane-1", type: "awaiting_input" }]);
    expect(get(store)).toBe(true);
  });

  it("emits false again after entries are cleared", () => {
    const { api, attention } = makeFakeApi([
      { paneId: "pane-1", type: "awaiting_input" },
    ]);
    const store = attentionPulseStore(api);
    expect(get(store)).toBe(true);
    attention.set([]);
    expect(get(store)).toBe(false);
  });

  it("subscribes and unsubscribes cleanly", () => {
    const { api } = makeFakeApi([]);
    const store = attentionPulseStore(api);
    // Multiple get() calls should not throw
    expect(() => {
      get(store);
      get(store);
      const unsub = store.subscribe(() => {});
      unsub();
    }).not.toThrow();
  });
});
