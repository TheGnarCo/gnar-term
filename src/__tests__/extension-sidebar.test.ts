import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  extensionSidebarSections,
  upsertSection,
  removeSection,
  primarySections,
  secondarySections,
  _resetExtensionSidebarForTest,
} from "../lib/stores/extension-sidebar";

describe("extension-sidebar store", () => {
  beforeEach(() => _resetExtensionSidebarForTest());

  it("starts empty", () => {
    expect(get(extensionSidebarSections).size).toBe(0);
    expect(get(primarySections)).toEqual([]);
    expect(get(secondarySections)).toEqual([]);
  });

  it("upserts primary and secondary sections separately", () => {
    upsertSection({
      side: "primary",
      sectionId: "p1",
      title: "P1",
      items: [{ id: "a", label: "A" }],
    });
    upsertSection({
      side: "secondary",
      sectionId: "s1",
      title: "S1",
      items: [{ id: "b", label: "B" }],
    });
    expect(get(primarySections)).toHaveLength(1);
    expect(get(secondarySections)).toHaveLength(1);
    expect(get(primarySections)[0].title).toBe("P1");
    expect(get(secondarySections)[0].title).toBe("S1");
  });

  it("replaces an existing section with the same id", () => {
    upsertSection({
      side: "secondary",
      sectionId: "s1",
      title: "first",
      items: [],
    });
    upsertSection({
      side: "secondary",
      sectionId: "s1",
      title: "second",
      items: [{ id: "x", label: "X" }],
    });
    const sections = get(secondarySections);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("second");
    expect(sections[0].items).toEqual([{ id: "x", label: "X" }]);
  });

  it("removeSection is safe for non-existent IDs", () => {
    removeSection("primary", "nope");
    expect(get(primarySections)).toEqual([]);
  });

  it("allows same section_id on different sides", () => {
    upsertSection({
      side: "primary",
      sectionId: "tools",
      title: "P",
      items: [],
    });
    upsertSection({
      side: "secondary",
      sectionId: "tools",
      title: "S",
      items: [],
    });
    expect(get(primarySections)).toHaveLength(1);
    expect(get(secondarySections)).toHaveLength(1);
    removeSection("primary", "tools");
    expect(get(primarySections)).toHaveLength(0);
    expect(get(secondarySections)).toHaveLength(1);
  });
});
