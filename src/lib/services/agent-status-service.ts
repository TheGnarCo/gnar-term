/**
 * Agent Status Service — shared constants and helpers for the
 * per-Workspace agent visibility contributions that ship with core.
 *
 * Core renders the agent-count subtitle, lifecycle pill, and per-agent
 * child rows under every Workspace banner so the visibility is the
 * Workspace's responsibility — independent of whether the `agentic`
 * extension is installed.
 */

import type { AgentState } from "./agent-state";

export const AGENT_STATUS_SOURCE = "core:agent-status";

/** The "agent-row" kind registered in the root-row renderer registry. */
export const AGENT_ROW_KIND = "agent-row";

/**
 * Agent statuses that should NOT appear in the per-Workspace banner
 * (terminal states from agent-state.ts). Active states surface as child
 * rows and count toward the subtitle badge.
 *
 * Typed `ReadonlySet<string>` (with `AgentState` values) so callers
 * can pass `DetectedAgent.status` (typed `string`) without a cast —
 * the values are still typed at the literal-array level so a typo
 * here is caught at build time.
 */
export const TERMINAL_AGENT_STATUSES: ReadonlySet<string> = new Set<AgentState>(
  ["errored", "completed"],
);

export function isActiveStatus(status: string): boolean {
  return !TERMINAL_AGENT_STATUSES.has(status);
}
