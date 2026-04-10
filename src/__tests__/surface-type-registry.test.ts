/**
 * Tests for the custom surface type registry.
 *
 * Extensions register new surface types (beyond terminal and preview).
 * Core uses the registry to look up the component for a given surface kind.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerSurfaceType,
  unregisterSurfaceType,
  unregisterSurfaceTypesBySource,
  getSurfaceType,
  surfaceTypeStore,
  resetSurfaceTypes,
} from "../lib/services/surface-type-registry";

describe("surfaceTypeStore", () => {
  beforeEach(() => {
    resetSurfaceTypes();
  });

  it("starts empty", () => {
    expect(get(surfaceTypeStore)).toEqual([]);
  });

  it("registers a surface type", () => {
    registerSurfaceType({
      id: "issue-detail",
      label: "Issue",
      component: "IssueDetail",
      source: "github-ext",
    });

    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(1);
    expect(types[0]).toEqual({
      id: "issue-detail",
      label: "Issue",
      component: "IssueDetail",
      source: "github-ext",
    });
  });

  it("replaces a surface type with the same id", () => {
    registerSurfaceType({
      id: "viewer",
      label: "Viewer",
      component: "Old",
      source: "ext-a",
    });
    registerSurfaceType({
      id: "viewer",
      label: "Viewer v2",
      component: "New",
      source: "ext-a",
    });

    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(1);
    expect(types[0].label).toBe("Viewer v2");
  });

  it("unregisters by id", () => {
    registerSurfaceType({
      id: "viewer",
      label: "Viewer",
      component: "A",
      source: "ext-a",
    });
    unregisterSurfaceType("viewer");

    expect(get(surfaceTypeStore)).toHaveLength(0);
  });

  it("unregisters all types from a source", () => {
    registerSurfaceType({
      id: "t1",
      label: "T1",
      component: "A",
      source: "ext-a",
    });
    registerSurfaceType({
      id: "t2",
      label: "T2",
      component: "B",
      source: "ext-a",
    });
    registerSurfaceType({
      id: "t3",
      label: "T3",
      component: "C",
      source: "ext-b",
    });

    unregisterSurfaceTypesBySource("ext-a");

    const types = get(surfaceTypeStore);
    expect(types).toHaveLength(1);
    expect(types[0].id).toBe("t3");
  });
});

describe("getSurfaceType", () => {
  beforeEach(() => {
    resetSurfaceTypes();
  });

  it("returns the registered type by id", () => {
    registerSurfaceType({
      id: "viewer",
      label: "Viewer",
      component: "ViewerComponent",
      source: "ext-a",
    });

    const result = getSurfaceType("viewer");
    expect(result).toBeDefined();
    expect(result!.component).toBe("ViewerComponent");
  });

  it("returns undefined for unregistered types", () => {
    expect(getSurfaceType("nonexistent")).toBeUndefined();
  });
});
