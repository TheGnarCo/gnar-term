/**
 * Tests for the primary sidebar section registry.
 *
 * Extensions register collapsible sections below the Workspaces section.
 * Core owns the header (label + chevron); extensions provide the content component.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  registerSidebarSection,
  unregisterSidebarSectionsBySource,
  sidebarSectionStore,
  resetSidebarSections,
} from "../lib/services/sidebar-section-registry";

describe("sidebarSectionStore", () => {
  beforeEach(() => {
    resetSidebarSections();
  });

  it("starts empty", () => {
    expect(get(sidebarSectionStore)).toEqual([]);
  });

  it("registers a section", () => {
    registerSidebarSection({
      id: "profile",
      label: "Profile",
      component: "ProfileCard",
      source: "profile-ext",
    });

    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toEqual({
      id: "profile",
      label: "Profile",
      component: "ProfileCard",
      source: "profile-ext",
    });
  });

  it("registers multiple sections from different sources", () => {
    registerSidebarSection({
      id: "profile",
      label: "Profile",
      component: "A",
      source: "ext-a",
    });
    registerSidebarSection({
      id: "git-info",
      label: "Git",
      component: "B",
      source: "ext-b",
    });

    expect(get(sidebarSectionStore)).toHaveLength(2);
  });

  it("replaces a section with the same id", () => {
    registerSidebarSection({
      id: "profile",
      label: "Profile",
      component: "Old",
      source: "ext-a",
    });
    registerSidebarSection({
      id: "profile",
      label: "Profile v2",
      component: "New",
      source: "ext-a",
    });

    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe("Profile v2");
  });

  it("unregisters all sections from a source", () => {
    registerSidebarSection({
      id: "s1",
      label: "S1",
      component: "A",
      source: "ext-a",
    });
    registerSidebarSection({
      id: "s2",
      label: "S2",
      component: "B",
      source: "ext-a",
    });
    registerSidebarSection({
      id: "s3",
      label: "S3",
      component: "C",
      source: "ext-b",
    });

    unregisterSidebarSectionsBySource("ext-a");

    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("s3");
  });
});
