/**
 * Agents Sidebar — pure data transformation for the cross-workspace
 * agent summary sidebar tab.
 *
 * `buildAgentRows` is intentionally side-effect-free so it can be
 * tested without Svelte store plumbing.
 */
import type { DetectedAgent } from "./agent-detection-service";
import type { NestedWorkspace } from "../types";
import type { Workspace } from "../config";
import { wsMeta } from "./service-helpers";

export interface AgentRow extends DetectedAgent {
  /** Display name of the nested workspace (Branch) the agent lives in. */
  ctxName: string;
  /** Display name of the parent umbrella workspace (Project). */
  projectName: string;
  /** Index of the nested workspace in the `nestedWorkspaces` store, or -1 if not found. */
  wsIdx: number;
}

/**
 * Map raw agent + workspace store values into displayable sidebar rows.
 * Filters out agents with status "closed" (detached agents that haven't
 * been removed from the store yet).
 */
export function buildAgentRows(
  agents: DetectedAgent[],
  nestedWsList: NestedWorkspace[],
  workspaces: Workspace[],
): AgentRow[] {
  return agents
    .filter((a) => a.status !== "closed")
    .map((a) => {
      const ctx = nestedWsList.find((w) => w.id === a.workspaceId);
      const parentId = ctx ? wsMeta(ctx).parentWorkspaceId : null;
      const project = parentId
        ? workspaces.find((w) => w.id === parentId)
        : null;
      const idx = nestedWsList.findIndex((w) => w.id === a.workspaceId);
      return {
        ...a,
        ctxName: ctx?.name ?? "Unknown Branch",
        projectName: project?.name ?? "Unknown Project",
        wsIdx: idx,
      };
    });
}
