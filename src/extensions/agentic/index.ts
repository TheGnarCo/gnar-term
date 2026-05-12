import type { ExtensionAPI } from "../api";
import AgenticIcon from "./AgenticIcon.svelte";
import AgenticDashboardBody from "./AgenticDashboardBody.svelte";
import { attentionPulseStore } from "./stores/attention-pulse";
import { registerWorkspaceContributions } from "./contributions/register-workspace-contributions";

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
  });

  api.onDeactivate(() => {
    // api.registerGlobalSurface lifecycle is owned by extension-loader;
    // it auto-cleans on deactivate. No manual teardown needed for cycle-2.
  });
}
