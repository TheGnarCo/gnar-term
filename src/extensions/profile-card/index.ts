/**
 * Profile Card — included extension
 *
 * Registers a primary sidebar section showing user profile info.
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import ProfileCard from "./ProfileCard.svelte";

export const profileCardManifest: ExtensionManifest = {
  id: "profile-card",
  name: "Profile Card",
  version: "0.1.0",
  description: "User profile card in the primary sidebar",
  entry: "./index.ts",
  included: true,
  contributes: {
    primarySidebarSections: [{ id: "profile", label: "Profile" }],
    settings: {
      fields: {
        name: {
          type: "string",
          title: "Name",
          description: "Display name shown in the sidebar",
          default: "User",
        },
        description: {
          type: "string",
          title: "Description",
          description: "Short text below your name (e.g. role or project)",
          default: "gnar-term",
        },
        avatarUrl: {
          type: "string",
          title: "Avatar URL",
          description: "URL to a profile image (leave empty to show initials)",
          default: "",
        },
      },
    },
  },
};

export function registerProfileCardExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerPrimarySidebarSection("profile", ProfileCard, {
      collapsible: false,
      showLabel: false,
    });
  });
}
