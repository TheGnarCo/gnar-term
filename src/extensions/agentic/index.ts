import { get } from "svelte/store";
import type { ExtensionAPI } from "../api";
import AgenticIcon from "./AgenticIcon.svelte";
import AgenticDashboardBody from "./AgenticDashboardBody.svelte";
import { attentionPulseStore } from "./stores/attention-pulse";
import { registerWorkspaceActions } from "./contributions/register-workspace-actions";

export { agenticManifest } from "./manifest";

const DASHBOARD_CONTRIBUTION_ID = "agentic:dashboard";

export function registerAgenticExtension(api: ExtensionAPI): void {
  api.onActivate(() => {
    const spawnOrNavigate = api.registerGlobalSurface("dashboard", {
      label: "Agentic",
      icon: AgenticIcon,
      component: AgenticDashboardBody,
      accentColor: "#A855F7",
    });

    const isActive = attentionPulseStore(api);

    api.registerTitleBarButton("agentic", {
      icon: AgenticIcon,
      title: "Agentic Dashboard",
      isActive,
      onClick: spawnOrNavigate,
    });

    registerWorkspaceActions(api);

    // Auto-provision the global Agentic dashboard so it appears in the
    // sidebar as soon as the extension is enabled. Subsequent app starts
    // see the persisted workspace and skip — no spurious switches on
    // restart. spawnOrNavigate is a no-op when the dashboard exists.
    api.onWorkspacesRestored(() => {
      const wsList = get(api.workspaces);
      const exists = wsList.some(
        (w) =>
          w.dashboardContributionId === DASHBOARD_CONTRIBUTION_ID &&
          w.rootWorkspaceId === undefined,
      );
      if (!exists) void spawnOrNavigate();
    });
  });

  api.onDeactivate(() => {
    // api.registerGlobalSurface and registerTitleBarButton are cleaned up by
    // the extension loader's source-cleanup pass (see extension-constants.ts).
    // registerWorkspaceAction is NOT documented as auto-cleaned in api.ts, so
    // we unregister explicitly here.
    api.unregisterWorkspaceAction("spawn-agentic-branch");
    api.unregisterWorkspaceAction("boot-agent-here");
  });
}
