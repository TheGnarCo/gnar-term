/**
 * Workspace Contributions — agentic extension
 *
 * Registers three affordances that surface agent state inside the
 * primary sidebar's Workspaces section:
 *
 *  1. WorkspaceSubtitle  — rendered below each workspace name; shows a
 *     live agent count badge and an optional lifecycle pill.
 *
 *  2. child-row contributor for "workspace" parent rows — emits one
 *     { kind: "agent-row", id: agentId } descriptor per active agent
 *     (excluding terminal states "errored" and "completed") in the
 *     given workspace.
 *
 *  3. AgentRowBanner renderer for the "agent-row" kind — a compact row
 *     showing the agent name + status pill.
 */
import { get } from "svelte/store";
import type { ExtensionAPI } from "../../api";
import WorkspaceSubtitle from "./WorkspaceSubtitle.svelte";
import AgentRowBanner from "./AgentRowBanner.svelte";

/** Terminal states from agent-state.ts — resist further transitions. */
const TERMINAL_STATUSES = new Set(["errored", "completed"]);

/**
 * Register workspace subtitle, child-row contributor, and agent-row
 * renderer. Call this inside `api.onActivate(...)`.
 */
export function registerWorkspaceContributions(api: ExtensionAPI): void {
  // 1. Subtitle: agent count + lifecycle pill below each workspace name.
  api.registerWorkspaceSubtitle(WorkspaceSubtitle);

  // 2. Child-row contributor: one "agent-row" per active agent in the workspace.
  //    The contribute function reads the LIVE store snapshot on each call so
  //    adding/removing agents is reflected immediately on the next re-emission
  //    from childRowContributors.
  api.registerChildRowContributor(
    "workspace",
    (workspaceId: string): Array<{ kind: string; id: string }> => {
      const agents = get(api.agents);
      return agents
        .filter(
          (a) =>
            a.workspaceId === workspaceId && !TERMINAL_STATUSES.has(a.status),
        )
        .map((a) => ({ kind: "agent-row", id: a.agentId }));
    },
  );

  // 3. Renderer for the "agent-row" kind emitted by the contributor above.
  api.registerRootRowRenderer("agent-row", AgentRowBanner);
}
