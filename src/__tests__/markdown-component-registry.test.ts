/**
 * Tests for the markdown-component registry — the registry that backs
 * `gnar:<name>` directive lookups inside markdown previews.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerMarkdownComponent,
  unregisterMarkdownComponentsBySource,
  getMarkdownComponent,
  listMarkdownComponents,
  markdownComponentStore,
  resetMarkdownComponents,
} from "../lib/services/markdown-component-registry";

describe("markdown-component registry", () => {
  beforeEach(() => {
    resetMarkdownComponents();
  });

  it("starts empty", () => {
    expect(get(markdownComponentStore)).toEqual([]);
    expect(listMarkdownComponents()).toEqual([]);
  });

  it("registers a component and exposes it via get / list / store", () => {
    const component = { __mock: "component-a" };
    registerMarkdownComponent({
      name: "counter",
      component,
      source: "core",
    });

    expect(getMarkdownComponent("counter")).toEqual({
      name: "counter",
      component,
      source: "core",
    });
    expect(listMarkdownComponents()).toHaveLength(1);
    expect(get(markdownComponentStore)).toHaveLength(1);
  });

  it("registers multiple components from different sources", () => {
    registerMarkdownComponent({
      name: "alpha",
      component: { a: 1 },
      source: "ext-a",
    });
    registerMarkdownComponent({
      name: "beta",
      component: { b: 2 },
      source: "ext-b",
    });

    expect(listMarkdownComponents()).toHaveLength(2);
  });

  it("re-registering with the same name replaces it (last-wins)", () => {
    const oldComponent = { v: "old" };
    const newComponent = { v: "new" };
    registerMarkdownComponent({
      name: "thing",
      component: oldComponent,
      source: "ext-a",
    });
    registerMarkdownComponent({
      name: "thing",
      component: newComponent,
      source: "ext-a",
    });

    expect(getMarkdownComponent("thing")?.component).toBe(newComponent);
    expect(listMarkdownComponents()).toHaveLength(1);
  });

  it("preserves optional configSchema field", () => {
    registerMarkdownComponent({
      name: "form",
      component: {},
      source: "core",
      configSchema: { fields: { x: { type: "string" } } },
    });

    expect(getMarkdownComponent("form")?.configSchema).toEqual({
      fields: { x: { type: "string" } },
    });
  });

  it("unregisterMarkdownComponentsBySource removes only matching entries", () => {
    registerMarkdownComponent({
      name: "w1",
      component: {},
      source: "ext-a",
    });
    registerMarkdownComponent({
      name: "w2",
      component: {},
      source: "ext-a",
    });
    registerMarkdownComponent({
      name: "w3",
      component: {},
      source: "ext-b",
    });

    unregisterMarkdownComponentsBySource("ext-a");

    const remaining = listMarkdownComponents();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("w3");
  });

  it("unregisterMarkdownComponentsBySource on unknown source is a no-op", () => {
    registerMarkdownComponent({
      name: "kept",
      component: {},
      source: "ext-a",
    });

    unregisterMarkdownComponentsBySource("nope");

    expect(listMarkdownComponents()).toHaveLength(1);
  });

  it("getMarkdownComponent returns undefined for unknown names", () => {
    expect(getMarkdownComponent("missing")).toBeUndefined();
  });
});
