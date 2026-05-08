/**
 * Agents Sidebar — pure data transformation for the cross-workspace
 * agent summary sidebar tab.
 *
 * `buildAgentRows` is intentionally side-effect-free so it can be
 * tested without Svelte store plumbing.
 */
import type { DetectedAgent } from "./agent-detection-service";
import type { Workspace } from "../types";
import type { RootWorkspace } from "../config";

export interface AgentRow extends DetectedAgent {
  /** Display name of the Branch the agent lives in. */
  ctxName: string;
  /** Display name of the Workspace this Branch belongs to. */
  workspaceName: string;
  /** Index of the Branch in the `workspaces` store, or -1 if not found. */
  wsIdx: number;
}

/**
 * Map raw agent + workspace store values into displayable sidebar rows.
 * Filters out agents with status "closed" (detached agents that haven't
 * been removed from the store yet).
 */
export function buildAgentRows(
  agents: DetectedAgent[],
  branchedWsList: Workspace[],
  workspaces: RootWorkspace[],
): AgentRow[] {
  return agents
    .filter((a) => a.status !== "closed")
    .map((a) => {
      const branch = branchedWsList.find((w) => w.id === a.workspaceId);
      const rootId = branch?.rootWorkspaceId ?? null;
      const root = rootId ? workspaces.find((w) => w.id === rootId) : null;
      const idx = branchedWsList.findIndex((w) => w.id === a.workspaceId);
      return {
        ...a,
        ctxName: branch?.name ?? "Unknown Branch",
        workspaceName: root?.name ?? "Unknown Workspace",
        wsIdx: idx,
      };
    });
}
