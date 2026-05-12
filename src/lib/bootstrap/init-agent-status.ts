/**
 * Agent Status bootstrap — core's per-Workspace agent visibility.
 *
 * Registers:
 *  - WorkspaceAgentSubtitle (agent count badge + branch-lifecycle pill)
 *    under every Workspace banner via the workspace-subtitle registry.
 *  - A child-row contributor for parentType "workspace" that emits one
 *    `{ kind: "agent-row", id: agentId }` per active agent.
 *  - WorkspaceAgentRow as the renderer for the "agent-row" kind.
 *
 * These contributions ship with core so per-Workspace agentic status is
 * a property of the Workspace itself — not dependent on any extension.
 * Global surfaces (the Agentic Dashboard, the TitleBar attention "hat")
 * remain extension territory.
 */
import { get } from "svelte/store";
import { registerWorkspaceSubtitle } from "../services/workspace-subtitle-registry";
import { registerChildRowContributor } from "../services/child-row-contributor-registry";
import { registerRootRowRenderer } from "../services/root-row-renderer-registry";
import { agentsStore } from "../services/agent-detection-service";
import {
  AGENT_STATUS_SOURCE,
  AGENT_ROW_KIND,
  TERMINAL_AGENT_STATUSES,
} from "../services/agent-status-service";
import WorkspaceAgentSubtitle from "../components/WorkspaceAgentSubtitle.svelte";
import WorkspaceAgentRow from "../components/WorkspaceAgentRow.svelte";

export function initAgentStatus(): void {
  registerWorkspaceSubtitle({
    id: `${AGENT_STATUS_SOURCE}:subtitle`,
    source: AGENT_STATUS_SOURCE,
    component: WorkspaceAgentSubtitle,
    priority: 30,
  });

  registerChildRowContributor({
    parentType: "workspace",
    source: AGENT_STATUS_SOURCE,
    contribute: (workspaceId: string) =>
      get(agentsStore)
        .filter(
          (a) =>
            a.workspaceId === workspaceId &&
            !TERMINAL_AGENT_STATUSES.has(a.status),
        )
        .map((a) => ({ kind: AGENT_ROW_KIND, id: a.agentId })),
  });

  registerRootRowRenderer({
    id: AGENT_ROW_KIND,
    source: AGENT_STATUS_SOURCE,
    component: WorkspaceAgentRow,
  });
}
