/**
 * Tests for the workspace-order store — append/prepend/insert/move/remove and
 * bootstrap reconciliation against a persisted list.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  workspaceOrder,
  setWorkspaceOrder,
  prependWorkspaceRow,
  appendWorkspaceRow,
  removeWorkspaceRow,
  insertWorkspaceRow,
  moveWorkspaceRow,
  bootstrapWorkspaceOrder,
  type WorkspaceRow,
} from "../lib/stores/workspace-order";

const row = (id: string): WorkspaceRow => ({ kind: "workspace", id });
const ids = (rows: WorkspaceRow[]) => rows.map((r) => r.id);

beforeEach(() => {
  setWorkspaceOrder([]);
});

describe("mutation helpers", () => {
  it("appends rows in order, deduping by kind+id", () => {
    appendWorkspaceRow(row("a"));
    appendWorkspaceRow(row("b"));
    appendWorkspaceRow(row("a")); // dup, ignored
    expect(ids(get(workspaceOrder))).toEqual(["a", "b"]);
  });

  it("prepends to the front, deduping", () => {
    appendWorkspaceRow(row("a"));
    prependWorkspaceRow(row("b"));
    prependWorkspaceRow(row("a")); // dup, ignored
    expect(ids(get(workspaceOrder))).toEqual(["b", "a"]);
  });

  it("inserts at an index, clamping out-of-range", () => {
    setWorkspaceOrder([row("a"), row("b"), row("c")]);
    insertWorkspaceRow(1, row("x"));
    expect(ids(get(workspaceOrder))).toEqual(["a", "x", "b", "c"]);
    insertWorkspaceRow(99, row("y"));
    expect(ids(get(workspaceOrder))).toEqual(["a", "x", "b", "c", "y"]);
  });

  it("insert is a no-op when the row already exists", () => {
    setWorkspaceOrder([row("a"), row("b")]);
    insertWorkspaceRow(0, row("b"));
    expect(ids(get(workspaceOrder))).toEqual(["a", "b"]);
  });

  it("removes a row by kind+id, no-op if missing", () => {
    setWorkspaceOrder([row("a"), row("b"), row("c")]);
    removeWorkspaceRow(row("b"));
    expect(ids(get(workspaceOrder))).toEqual(["a", "c"]);
    removeWorkspaceRow(row("zzz"));
    expect(ids(get(workspaceOrder))).toEqual(["a", "c"]);
  });

  it("moves a row forward and backward", () => {
    setWorkspaceOrder([row("a"), row("b"), row("c"), row("d")]);
    moveWorkspaceRow(0, 2); // a after b
    expect(ids(get(workspaceOrder))).toEqual(["b", "a", "c", "d"]);
    moveWorkspaceRow(3, 0); // d to front
    expect(ids(get(workspaceOrder))).toEqual(["d", "b", "a", "c"]);
  });

  it("move ignores out-of-range source indices", () => {
    setWorkspaceOrder([row("a"), row("b")]);
    moveWorkspaceRow(5, 0);
    expect(ids(get(workspaceOrder))).toEqual(["a", "b"]);
  });

  it("dedup tracking survives a move (re-adding the moved id is a no-op)", () => {
    setWorkspaceOrder([row("a"), row("b"), row("c")]);
    moveWorkspaceRow(0, 3);
    appendWorkspaceRow(row("a")); // already present after move
    expect(ids(get(workspaceOrder))).toEqual(["b", "c", "a"]);
  });
});

describe("bootstrapWorkspaceOrder", () => {
  it("with no persisted list, yields currentRows in order", () => {
    bootstrapWorkspaceOrder([row("a"), row("b"), row("c")]);
    expect(ids(get(workspaceOrder))).toEqual(["a", "b", "c"]);
  });

  it("preserves persisted order where referents are still known", () => {
    bootstrapWorkspaceOrder(
      [row("a"), row("b"), row("c")],
      [row("c"), row("a"), row("b")],
    );
    expect(ids(get(workspaceOrder))).toEqual(["c", "a", "b"]);
  });

  it("drops persisted entries whose referent is unknown", () => {
    bootstrapWorkspaceOrder(
      [row("a"), row("b")],
      [row("b"), row("ghost"), row("a")],
    );
    expect(ids(get(workspaceOrder))).toEqual(["b", "a"]);
  });

  it("appends current rows missing from the persisted list", () => {
    bootstrapWorkspaceOrder(
      [row("a"), row("b"), row("c")],
      [row("b")],
    );
    expect(ids(get(workspaceOrder))).toEqual(["b", "a", "c"]);
  });

  it("deduplicates a persisted list that repeats a referent", () => {
    bootstrapWorkspaceOrder([row("a"), row("b")], [row("a"), row("a"), row("b")]);
    expect(ids(get(workspaceOrder))).toEqual(["a", "b"]);
  });
});
