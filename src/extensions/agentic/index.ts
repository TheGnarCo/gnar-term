import type { ExtensionAPI } from "../api";
import AgenticIcon from "./AgenticIcon.svelte";
import AgenticDashboardBody from "./AgenticDashboardBody.svelte";
import { attentionPulseStore } from "./stores/attention-pulse";
import { registerWorkspaceContributions } from "./contributions/register-workspace-contributions";
import { registerWorkspaceActions } from "./contributions/register-workspace-actions";

export { agenticManifest } from "./manifest";

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

    registerWorkspaceContributions(api);
    registerWorkspaceActions(api);
  });

  api.onDeactivate(() => {
    // api.registerGlobalSurface, registerChildRowContributor, registerRootRowRenderer,
    // registerWorkspaceSubtitle, and registerTitleBarButton are all cleaned up by
    // the extension loader's source-cleanup pass (see extension-constants.ts).
    // registerWorkspaceAction is NOT documented as auto-cleaned in api.ts, so
    // we unregister explicitly here.
    api.unregisterWorkspaceAction("spawn-agentic-branch");
    api.unregisterWorkspaceAction("boot-agent-here");
  });
}
