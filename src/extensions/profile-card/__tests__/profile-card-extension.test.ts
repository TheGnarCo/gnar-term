/**
 * Tests for the profile-card included extension — validates that profile-card
 * registers itself as a primary sidebar section via the extension API.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import { profileCardManifest, registerProfileCardExtension } from "..";
import {
  sidebarSectionStore,
  resetSidebarSections,
} from "../../../lib/services/sidebar-section-registry";
import {
  registerExtension,
  activateExtension,
  resetExtensions,
} from "../../../lib/services/extension-loader";

describe("Profile Card included extension", () => {
  beforeEach(async () => {
    await resetExtensions();
    resetSidebarSections();
  });

  it("manifest has correct id and metadata", () => {
    expect(profileCardManifest.id).toBe("profile-card");
    expect(profileCardManifest.name).toBe("Profile Card");
    expect(profileCardManifest.included).toBe(true);
  });

  it("manifest declares name, description, and avatarUrl settings", () => {
    const fields = profileCardManifest.contributes?.settings?.fields;
    expect(fields).toBeTruthy();
    expect(fields!.name).toMatchObject({
      type: "string",
      title: "Name",
      default: "User",
    });
    expect(fields!.description).toMatchObject({
      type: "string",
      title: "Description",
      default: "gnar-term",
    });
    expect(fields!.avatarUrl).toMatchObject({
      type: "string",
      title: "Avatar URL",
      default: "",
    });
  });

  it("registers section via API with namespaced id", async () => {
    registerExtension(profileCardManifest, registerProfileCardExtension);
    await activateExtension("profile-card");
    const sections = get(sidebarSectionStore);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("profile-card:profile");
    expect(sections[0].label).toBe("Profile");
    expect(sections[0].source).toBe("profile-card");
    expect(sections[0].component).toBeTruthy();
  });
});
