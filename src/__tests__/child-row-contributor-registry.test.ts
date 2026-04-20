/**
 * Tests for the child-row contributor registry — registration,
 * enumeration by parentType + parentId, and per-source cleanup.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerChildRowContributor,
  unregisterChildRowContributorsBySource,
  getChildRowsFor,
  childRowContributorStore,
  resetChildRowContributors,
  type ContributedChildRow,
} from "../lib/services/child-row-contributor-registry";

describe("child-row contributor registry", () => {
  beforeEach(() => {
    resetChildRowContributors();
  });

  it("starts empty", () => {
    expect(get(childRowContributorStore)).toEqual([]);
    expect(getChildRowsFor("project", "p1")).toEqual([]);
  });

  it("registers a contributor and enumerates its rows", () => {
    registerChildRowContributor({
      parentType: "project",
      source: "agentic-orchestrator",
      contribute: (parentId) => [
        { kind: "agent-orchestrator", id: `${parentId}-d1` },
      ],
    });

    expect(getChildRowsFor("project", "p1")).toEqual([
      { kind: "agent-orchestrator", id: "p1-d1" },
    ]);
  });

  it("returns empty list for a parentType with no contributors", () => {
    registerChildRowContributor({
      parentType: "project",
      source: "ext-a",
      contribute: () => [{ kind: "x", id: "y" }],
    });

    expect(getChildRowsFor("dashboard", "anything")).toEqual([]);
  });

  it("multiple contributors targeting the same parentType concatenate", () => {
    registerChildRowContributor({
      parentType: "project",
      source: "ext-a",
      contribute: () => [{ kind: "k1", id: "a1" }],
    });
    registerChildRowContributor({
      parentType: "project",
      source: "ext-b",
      contribute: () => [
        { kind: "k2", id: "b1" },
        { kind: "k2", id: "b2" },
      ],
    });

    const rows = getChildRowsFor("project", "p1");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "b1", "b2"]);
  });

  it("contributor receives the parentId on each call", () => {
    const calls: string[] = [];
    registerChildRowContributor({
      parentType: "project",
      source: "ext-a",
      contribute: (parentId) => {
        calls.push(parentId);
        return [];
      },
    });

    getChildRowsFor("project", "p1");
    getChildRowsFor("project", "p2");
    expect(calls).toEqual(["p1", "p2"]);
  });

  it("unregisterChildRowContributorsBySource removes only matching contributors", () => {
    registerChildRowContributor({
      parentType: "project",
      source: "ext-a",
      contribute: () => [{ kind: "x", id: "a1" }],
    });
    registerChildRowContributor({
      parentType: "project",
      source: "ext-b",
      contribute: () => [{ kind: "x", id: "b1" }],
    });

    unregisterChildRowContributorsBySource("ext-a");

    const remaining = get(childRowContributorStore);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].source).toBe("ext-b");
    expect(getChildRowsFor("project", "p")).toEqual([{ kind: "x", id: "b1" }]);
  });

  it("a throwing contributor doesn't poison its peers", () => {
    registerChildRowContributor({
      parentType: "project",
      source: "ext-bad",
      contribute: (): ContributedChildRow[] => {
        throw new Error("boom");
      },
    });
    registerChildRowContributor({
      parentType: "project",
      source: "ext-good",
      contribute: () => [{ kind: "x", id: "g1" }],
    });

    const rows = getChildRowsFor("project", "p1");
    expect(rows).toEqual([{ kind: "x", id: "g1" }]);
  });

  it("childRowContributorStore reflects registrations reactively", () => {
    expect(get(childRowContributorStore)).toEqual([]);
    registerChildRowContributor({
      parentType: "project",
      source: "ext-a",
      contribute: () => [],
    });
    expect(get(childRowContributorStore)).toHaveLength(1);
  });
});
