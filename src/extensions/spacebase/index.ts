import type { ExtensionManifest, ExtensionAPI, WorkspaceRef } from "../api";
import { createSpacebaseClient } from "./api-client";
import {
  createAuthStore,
  resolveAuthConfig,
  type AuthStore,
  type AuthStatus,
} from "./auth-store";
import { derived, type Readable } from "svelte/store";
import SpacebaseMark from "./icons/SpacebaseMark.svelte";
import SpacebaseRegistry from "./SpacebaseRegistry.svelte";
import SpacebaseWorkspaceDashboard from "./SpacebaseWorkspaceDashboard.svelte";

const WORKSPACE_DASHBOARD_ID = "workspace-dashboard";
const WORKSPACE_DASHBOARD_SURFACE = "spacebase:workspace-dashboard";

let authStoreSingleton: AuthStore | null = null;

/** Test-only accessor for the auth store materialized at activate time. */
export function __getSpacebaseAuthStoreForTest(): AuthStore | null {
  return authStoreSingleton;
}

export type { AuthStatus };
export type SpacebaseAuthStatusStore = Readable<AuthStatus>;

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
  api.onActivate(async () => {
    const env = readSpacebaseEnv();
    const store = createAuthStore({
      getConfig: () => resolveAuthConfig(api.getSettings(), env),
      makeClient: (cfg) =>
        createSpacebaseClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }),
    });
    authStoreSingleton = store;

    const openRegistry = api.registerGlobalSurface("registry", {
      label: "Spacebase",
      icon: SpacebaseMark,
      component: SpacebaseRegistry,
    });

    const visible = derived(
      api.settings,
      ($s) => $s.showTitleBarIcon !== false,
    );
    api.registerTitleBarButton("registry", {
      icon: SpacebaseMark,
      title: "Spacebase",
      visible,
      onClick: openRegistry,
    });

    api.registerSurfaceType(
      WORKSPACE_DASHBOARD_ID,
      SpacebaseWorkspaceDashboard,
      { hideFromNewSurface: true },
    );
    api.registerDashboardContribution({
      id: WORKSPACE_DASHBOARD_ID,
      label: "Spacebase",
      actionLabel: "Add Spacebase Dashboard",
      capPerWorkspace: 1,
      icon: SpacebaseMark,
      create: (workspace) => createWorkspaceDashboard(api, workspace),
    });

    await store.refresh();
  });
  api.onDeactivate(() => {
    authStoreSingleton = null;
  });
}

async function createWorkspaceDashboard(
  api: ExtensionAPI,
  workspace: WorkspaceRef,
): Promise<string> {
  return await api.createWorkspaceFromDef({
    name: "Spacebase",
    layout: {
      pane: {
        surfaces: [
          {
            type: "registry",
            extensionType: WORKSPACE_DASHBOARD_SURFACE,
            extensionProps: { rootWorkspaceId: workspace.id },
            name: "Spacebase",
            focus: true,
          },
        ],
      },
    },
    isDashboard: true,
    rootWorkspaceId: workspace.id,
    dashboardContributionId: WORKSPACE_DASHBOARD_ID,
  });
}

function readSpacebaseEnv(): {
  SPACEBASE_API_KEY?: string;
  SPACEBASE_URL?: string;
  SPACEBASE_PROJECT_ID?: string;
} {
  // Tauri exposes only declared env vars on the JS side via Vite's
  // import.meta.env or process.env (not present in the renderer). The
  // extension API doesn't surface env access today, so we read from
  // globalThis.process when available and otherwise fall through with no
  // env fallback. Settings remain the source of truth.
  const proc = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  const env = proc?.env ?? {};
  return {
    SPACEBASE_API_KEY: env.SPACEBASE_API_KEY,
    SPACEBASE_URL: env.SPACEBASE_URL,
    SPACEBASE_PROJECT_ID: env.SPACEBASE_PROJECT_ID,
  };
}
