import type { ExtensionManifest, ExtensionAPI } from "../api";

export const spacebaseManifest: ExtensionManifest = {
  id: "spacebase",
  name: "Spacebase",
  version: "0.1.0",
  description:
    "Browse Spacebase clients, projects, and docs from the title bar; preview project markdown locally per workspace.",
  entry: "./index.ts",
  included: true,
  permissions: ["filesystem"],
  contributes: {
    settings: {
      fields: {
        apiKey: {
          type: "string",
          title: "API key",
          description:
            "Spacebase Bearer token (sw_...). Treated as a secret — stored in settings.json on disk; do not commit project-level settings files containing this value.",
          default: "",
        },
        baseUrl: {
          type: "string",
          title: "Base URL",
          description:
            "Spacebase API base URL. Override for staging or self-hosted instances.",
          default: "https://spacebase.thegnar.com",
        },
        projectId: {
          type: "string",
          title: "Default project ID",
          description:
            "Default Spacebase project for the workspace dashboard. Resolved from /me when blank.",
          default: "",
        },
        syncDir: {
          type: "string",
          title: "Sync directory",
          description:
            "Path (relative to workspace CWD) scanned for local .md files in the workspace dashboard. Mirrors spacebase-sync.sh's SYNC_DIR.",
          default: ".",
        },
        showTitleBarIcon: {
          type: "boolean",
          title: "Show title bar icon",
          description: "Display the Spacebase registry icon in the title bar.",
          default: true,
        },
      },
    },
  },
};

export function registerSpacebaseExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    // Stories 2-5 wire surfaces, the title bar button, and the workspace
    // dashboard. Story 1 only proves the extension loads cleanly.
    void api;
  });
}
