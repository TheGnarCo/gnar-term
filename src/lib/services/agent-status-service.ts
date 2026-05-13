/**
 * Agent Status Service — shared constants and helpers for the
 * per-Workspace agent visibility contributions that ship with core.
 *
 * Core renders the agent-count subtitle, lifecycle pill, and per-agent
 * inline status rows under every Workspace banner so the visibility is
 * the Workspace's responsibility — independent of whether the `agentic`
 * extension is installed.
 */

import type { AgentState } from "./agent-state";
import type { BotStatus } from "../utils/bot-status-color";

export const AGENT_STATUS_SOURCE = "core:agent-status";

/**
 * Agent statuses that should NOT count as "active" for the per-Workspace
 * banner (terminal states from agent-state.ts). Active states surface as
 * inline subtitle rows and count toward the subtitle badge.
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

/**
 * Map a single agent's status to its color bucket. Mirrors the
 * precedence used by rail-attention's `computeRailBotStatus`:
 *
 *   - waiting              → attention (yellow)
 *   - running / active     → thinking  (green)
 *   - idle / done          → idle      (grey)
 *   - anything else        → none      (no color)
 *
 * Used by inline agent rows so the bot icon next to each agent matches
 * the color of the rail's bot-status bubble for that agent's bucket.
 */
export function agentStatusBucket(status: string): BotStatus {
  if (status === "waiting") return "attention";
  if (status === "running" || status === "active") return "thinking";
  if (status === "idle" || status === "done") return "idle";
  return "none";
}
