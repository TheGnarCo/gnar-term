/**
 * Agentic Orchestrator — registers the Agentic Dashboard contribution
 * (per-workspace, capPerWorkspace=1) and the Global Agentic Dashboard
 * pseudo-workspace.
 *
 * Passive detection lives in core (src/lib/services/agent-detection-service.ts);
 * this extension consumes agents via `api.agents`. The previous
 * AgentOrchestrator entity was collapsed into a dashboard contribution — no
 * standalone root-level orchestrator row, no orchestrator CRUD. Widgets
 * pull their scope from the enclosing DashboardHostContext (spec §5.3);
 * this extension provides two such hosts:
 *   1. A dashboard workspace materialized by the `agentic` contribution
 *      on a workspace. The dashboard component (AgenticDashboardBody) is
 *      registered as a hidden surface type and mounted inside a normal
 *      pane, so users keep TabBar / split / new-tab affordances around
 *      the dashboard surface. The component reads `rootWorkspaceId`
 *      from `surface.props` and projects it into a DashboardHostContext
 *      so embedded widgets resolve their scope unchanged.
 *   2. The `agentic.global` pseudo-workspace (synthetic metadata with
 *      `isGlobalAgenticDashboard: true` → global scope).
 */
import type { ExtensionManifest, ExtensionAPI } from "../api";
import {
  registerDashboardSection,
  unregisterDashboardSection,
} from "../../lib/services/dashboard-section-registry";
import {
  registerGlobalSurface,
  unregisterGlobalSurface,
  globalSurfaceTypeId,
} from "../../lib/services/global-surface-service";
import BotIcon from "./icons/BotIcon.svelte";
import GlobalAgenticDashboardBody from "./components/GlobalAgenticDashboardBody.svelte";
import AgenticDashboardBody from "./components/AgenticDashboardBody.svelte";
import AgentStatusGrid from "./components/AgentStatusGrid.svelte";
import Issues from "./components/Issues.svelte";
import Prs from "./components/Prs.svelte";

// --- Manifest ---

export const agenticOrchestratorManifest: ExtensionManifest = {
  id: "agentic-orchestrator",
  name: "Agentic Orchestrator",
  version: "0.5.0",
  description:
    "Agentic Dashboard contribution (per-workspace, cap 1) + Global Agentic pseudo-workspace. Consumes core's passive detection via api.agents.",
  entry: "./index.ts",
  included: true,
  permissions: ["filesystem"],
  contributes: {},
};

// --- Registration ---

export function registerAgenticOrchestratorExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    api.registerDashboardContribution({
      id: "agentic",
      label: "Agentic Dashboard",
      actionLabel: "Add Agentic Dashboard",
      capPerWorkspace: 1,
      icon: BotIcon,
      defaultEnabled: true,
      openAsTab: async (workspace, opts) => {
        await api.openDashboardTab(
          workspace.id,
          {
            kind: "registry",
            surfaceTypeId: globalSurfaceTypeId("agentic"),
            title: "Agents",
            props: { rootWorkspaceId: workspace.id },
            matchProps: { rootWorkspaceId: workspace.id },
            dashboardContributionId: "agentic",
          },
          opts,
        );
      },
    });

    registerGlobalSurface({
      id: "agentic",
      label: "Agentic Dashboard",
      icon: BotIcon,
      component: AgenticDashboardBody,
      source: "agentic-orchestrator",
    });

    api.onDeactivate(() => {
      unregisterGlobalSurface("agentic");
    });

    const CLOSED_KEY = "globalDashboardClosed";

    function registerReopenAction(): void {
      api.registerWorkspaceAction("reopen-global-dashboard", {
        label: "Agents Dashboard",
        zone: "workspace",
        handler: () => {
          void api.state.set(CLOSED_KEY, false);
          api.unregisterWorkspaceAction("reopen-global-dashboard");
          registerGlobalDashboard();
        },
      });
    }

    function registerGlobalDashboard(): void {
      api.registerPseudoWorkspace({
        id: "agentic.global",
        label: "Agents dashboard",
        position: "root-top",
        icon: BotIcon,
        render: GlobalAgenticDashboardBody,
        rowBody: AgentStatusGrid,
        metadata: { isGlobalAgenticDashboard: true },
        onClose() {
          void api.state.set(CLOSED_KEY, true);
          api.unregisterWorkspaceAction("reopen-global-dashboard");
          registerReopenAction();
        },
      });
    }

    const wasClosed = api.state.get<boolean>(CLOSED_KEY);
    if (wasClosed) {
      registerReopenAction();
    } else {
      registerGlobalDashboard();
    }

    // Dashboard-section registrations — let other dashboard bodies
    // compose these widgets without going through the markdown widget
    // pipeline. Each section is mounted via ExtensionWrapper using
    // `source` to resolve this extension's API at render time.
    registerDashboardSection({
      id: "issues",
      source: "agentic-orchestrator",
      component: Issues,
    });
    registerDashboardSection({
      id: "prs",
      source: "agentic-orchestrator",
      component: Prs,
    });

    api.onDeactivate(() => {
      unregisterDashboardSection("issues");
      unregisterDashboardSection("prs");
    });
  });

  // Auto-provisioned dashboards are torn down by the registry cleanup
  // pipeline on deactivate (closeAutoDashboardsBySource runs before
  // unregisterDashboardContributionsBySource), so no onDeactivate hook
  // is needed here.
}

// --- Internal helpers ---
