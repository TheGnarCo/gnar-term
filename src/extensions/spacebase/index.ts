import type { ExtensionManifest, ExtensionAPI } from "../api";
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

const DASHBOARD_CONTRIBUTION_ID = "spacebase-dashboard";
/**
 * Surface type id (pre-namespacing) for the per-workspace Spacebase
 * dashboard body. `api.registerSurfaceType` and `api.openDashboardTab`
 * both apply the `spacebase:` extension prefix automatically, so the
 * persisted surface ends up as `spacebase:spacebase-dashboard`.
 */
const DASHBOARD_SURFACE_ID = DASHBOARD_CONTRIBUTION_ID;

let authStoreSingleton: AuthStore | null = null;

/**
 * Accessor for the auth store materialized at activate time. Used by
 * extension-side Svelte components (registry, per-workspace dashboard)
 * to subscribe to auth status, and by tests to assert the store's
 * lifecycle.
 */
export function getSpacebaseAuthStore(): AuthStore | null {
  return authStoreSingleton;
}

function authSignature(s: Record<string, unknown>): string {
  const k = typeof s.apiKey === "string" ? s.apiKey : "";
  const b = typeof s.baseUrl === "string" ? s.baseUrl : "";
  const p = typeof s.projectId === "string" ? s.projectId : "";
  return `${k}|${b}|${p}`;
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
            "Default Spacebase project for the per-workspace dashboard. Resolved from /me when blank (used when the user has a single project).",
          default: "",
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
  let unsubSettings: (() => void) | null = null;

  api.onActivate(async () => {
    const env = readSpacebaseEnv();
    const store = createAuthStore({
      getConfig: () => resolveAuthConfig(api.getSettings(), env),
      makeClient: (cfg) =>
        createSpacebaseClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl }),
    });
    authStoreSingleton = store;

    // Re-validate whenever the auth-relevant settings change. Without
    // this, a user editing the API key or base URL never sees the
    // status flip from `not-configured`/`invalid` to `valid` until the
    // app reloads. Compare a stable signature so unrelated settings
    // mutations (e.g. showTitleBarIcon) don't thrash /me.
    let lastSig = authSignature(api.getSettings());
    let firstEmit = true;
    unsubSettings = api.settings.subscribe((s) => {
      const sig = authSignature(s);
      if (firstEmit) {
        firstEmit = false;
        lastSig = sig;
        return;
      }
      if (sig !== lastSig) {
        lastSig = sig;
        void store.refresh();
      }
    });

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

    api.registerSurfaceType(DASHBOARD_SURFACE_ID, SpacebaseWorkspaceDashboard, {
      hideFromNewSurface: true,
    });

    api.registerDashboardContribution({
      id: DASHBOARD_CONTRIBUTION_ID,
      label: "Spacebase",
      actionLabel: "Add Spacebase Dashboard",
      capPerWorkspace: 1,
      icon: SpacebaseMark,
      // Default-on: the contribution back-fills onto every workspace
      // when the extension activates (and tears down on deactivate via
      // the registry's auto-dashboard cleanup). Users can still dismiss
      // per-workspace from Workspace Settings.
      defaultEnabled: true,
      openAsTab: async (workspace, opts) => {
        await api.openDashboardTab(
          workspace.id,
          {
            kind: "registry",
            surfaceTypeId: DASHBOARD_SURFACE_ID,
            title: "Spacebase",
            props: { rootWorkspaceId: workspace.id },
            matchProps: { rootWorkspaceId: workspace.id },
            dashboardContributionId: DASHBOARD_CONTRIBUTION_ID,
          },
          opts,
        );
      },
    });

    await store.refresh();
  });
  api.onDeactivate(() => {
    if (unsubSettings) {
      unsubSettings();
      unsubSettings = null;
    }
    authStoreSingleton = null;
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
