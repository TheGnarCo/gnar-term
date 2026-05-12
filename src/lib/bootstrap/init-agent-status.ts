/**
 * Agent Status bootstrap — core's per-Workspace agent visibility.
 *
 * Registers WorkspaceAgentSubtitle as a Workspace subtitle so the
 * agent-count badge, branch-lifecycle pill, and one inline row per
 * active agent appear under every Workspace banner — between the
 * title and the CWD line. Renders nothing when no agents are present.
 *
 * Ships with core so per-Workspace agentic status is a property of
 * the Workspace itself — not dependent on any extension. Global
 * surfaces (the Agentic Dashboard, the TitleBar attention "hat")
 * remain extension territory.
 */
import { registerWorkspaceSubtitle } from "../services/workspace-subtitle-registry";
import { AGENT_STATUS_SOURCE } from "../services/agent-status-service";
import WorkspaceAgentSubtitle from "../components/WorkspaceAgentSubtitle.svelte";

export function initAgentStatus(): void {
  registerWorkspaceSubtitle({
    id: `${AGENT_STATUS_SOURCE}:subtitle`,
    source: AGENT_STATUS_SOURCE,
    component: WorkspaceAgentSubtitle,
    priority: 5,
  });
}
