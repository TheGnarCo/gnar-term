import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

// Mock saveState/getState so the store doesn't try to touch the
// filesystem via the Tauri bridge during tests.
let mockState: { rootRowOrder?: { kind: string; id: string }[] } = {};
vi.mock("../lib/config", () => ({
  saveState: vi.fn(async (updates: Record<string, unknown>) => {
    mockState = { ...mockState, ...updates };
  }),
  getState: () => mockState,
}));

import {
  rootRowOrder,
  appendRootRow,
  removeRootRow,
  moveRootRow,
  setRootRowOrder,
  bootstrapRootRowOrder,
} from "../lib/stores/root-row-order";

beforeEach(() => {
  setRootRowOrder([]);
  mockState = {};
});

describe("appendRootRow", () => {
  it("appends rows in insertion order", () => {
    appendRootRow({ kind: "workspace", id: "w1" });
    appendRootRow({ kind: "workspace-group", id: "p1" });
    appendRootRow({ kind: "workspace", id: "w2" });
    expect(get(rootRowOrder)).toEqual([
      { kind: "workspace", id: "w1" },
      { kind: "workspace-group", id: "p1" },
      { kind: "workspace", id: "w2" },
    ]);
  });

  it("is idempotent on repeat inserts of the same row", () => {
    appendRootRow({ kind: "workspace-group", id: "p1" });
    appendRootRow({ kind: "workspace-group", id: "p1" });
    expect(get(rootRowOrder)).toHaveLength(1);
  });

  it("treats workspace:X and project:X as distinct rows", () => {
    appendRootRow({ kind: "workspace", id: "shared" });
    appendRootRow({ kind: "workspace-group", id: "shared" });
    expect(get(rootRowOrder)).toHaveLength(2);
  });
});

describe("removeRootRow", () => {
  it("removes a specific {kind, id} pair", () => {
    appendRootRow({ kind: "workspace", id: "w1" });
    appendRootRow({ kind: "workspace-group", id: "p1" });
    removeRootRow({ kind: "workspace", id: "w1" });
    expect(get(rootRowOrder)).toEqual([{ kind: "workspace-group", id: "p1" }]);
  });

  it("is a no-op when the row isn't present", () => {
    appendRootRow({ kind: "workspace-group", id: "p1" });
    removeRootRow({ kind: "workspace", id: "missing" });
    expect(get(rootRowOrder)).toEqual([{ kind: "workspace-group", id: "p1" }]);
  });
});

describe("moveRootRow", () => {
  it("reorders items, accounting for the shift when moving forward", () => {
    // [w1, w2, w3, w4] → move idx 0 to idx 2 should yield [w2, w3, w1, w4]
    // (drop-before-target semantics: `to` indexes the DESTINATION slot
    // before splicing out the source, so passing 2 places the source
    // at what becomes index 1 after the -1 adjustment).
    appendRootRow({ kind: "workspace", id: "w1" });
    appendRootRow({ kind: "workspace", id: "w2" });
    appendRootRow({ kind: "workspace", id: "w3" });
    appendRootRow({ kind: "workspace", id: "w4" });
    moveRootRow(0, 2);
    expect(get(rootRowOrder).map((r) => r.id)).toEqual([
      "w2",
      "w1",
      "w3",
      "w4",
    ]);
  });

  it("handles backward moves (no index shift)", () => {
    appendRootRow({ kind: "workspace", id: "w1" });
    appendRootRow({ kind: "workspace", id: "w2" });
    appendRootRow({ kind: "workspace", id: "w3" });
    moveRootRow(2, 0);
    expect(get(rootRowOrder).map((r) => r.id)).toEqual(["w3", "w1", "w2"]);
  });

  it("is a no-op for an out-of-range source index", () => {
    appendRootRow({ kind: "workspace", id: "w1" });
    moveRootRow(5, 0);
    expect(get(rootRowOrder).map((r) => r.id)).toEqual(["w1"]);
  });
});

describe("bootstrapRootRowOrder", () => {
  it("preserves persisted order for known entities", () => {
    mockState = {
      rootRowOrder: [
        { kind: "workspace-group", id: "p1" },
        { kind: "workspace", id: "w1" },
        { kind: "workspace-group", id: "p2" },
      ],
    };
    bootstrapRootRowOrder(
      ["w1"],
      [
        { kind: "workspace-group", id: "p1" },
        { kind: "workspace-group", id: "p2" },
      ],
    );
    expect(get(rootRowOrder)).toEqual([
      { kind: "workspace-group", id: "p1" },
      { kind: "workspace", id: "w1" },
      { kind: "workspace-group", id: "p2" },
    ]);
  });

  it("drops entries whose referent no longer exists", () => {
    mockState = {
      rootRowOrder: [
        { kind: "workspace-group", id: "p_gone" },
        { kind: "workspace", id: "w1" },
      ],
    };
    bootstrapRootRowOrder(["w1"], []);
    expect(get(rootRowOrder)).toEqual([{ kind: "workspace", id: "w1" }]);
  });

  it("appends newly-known entities (projects before unclaimed workspaces) for first-run installs", () => {
    mockState = {};
    bootstrapRootRowOrder(
      ["w1", "w2"],
      [{ kind: "workspace-group", id: "p1" }],
    );
    expect(get(rootRowOrder)).toEqual([
      { kind: "workspace-group", id: "p1" },
      { kind: "workspace", id: "w1" },
      { kind: "workspace", id: "w2" },
    ]);
  });

  it("appends partially-known entities at the end while preserving persisted order", () => {
    mockState = {
      rootRowOrder: [{ kind: "workspace-group", id: "p1" }],
    };
    bootstrapRootRowOrder(
      ["w1"],
      [
        { kind: "workspace-group", id: "p1" },
        { kind: "workspace-group", id: "p_new" },
      ],
    );
    expect(get(rootRowOrder)).toEqual([
      { kind: "workspace-group", id: "p1" },
      { kind: "workspace-group", id: "p_new" },
      { kind: "workspace", id: "w1" },
    ]);
  });
});
