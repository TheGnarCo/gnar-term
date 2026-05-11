/**
 * Rail bot status — pure aggregator that decides whether a Root
 * workspace's rail should paint a status hat and which variant. The
 * hat renders at every sidebar width (collapsed and expanded) since
 * it's the canonical bot-notification surface. Mirrors the
 * buildAgentRows pattern (pure, store-free, vitest-testable). Scope
 * is intentionally Root + all branches, in contrast to
 * WorkspaceSectionContent's banner-level workspaceBotStatus, which
 * is root-only.
 *
 *   - "attention": at least one agent in the tree is waiting → yellow
 *                  pulsing hat (highest priority).
 *   - "thinking":  no waiting agents, but at least one is actively
 *                  working (running or active) → green static hat.
 *   - "idle":      no thinking/attention, but at least one detected
 *                  agent is present (idle or done) → muted-grey
 *                  static hat. Surfaces "agent attached, currently
 *                  thinking" so presence is never invisible.
 *   - "none":      no agents in the tree → no hat painted.
 */
import type { DetectedAgent } from "./agent-detection-service";
import type { RootWorkspace } from "../config";
import type { AttentionEvent } from "./attention-api";

export type RailBotStatus = "none" | "thinking" | "attention" | "idle";

const THINKING_STATUSES = new Set(["running", "active"]);
const IDLE_STATUSES = new Set(["idle", "done"]);
// "closed" means the agent process is gone — don't paint a hat for
// a tombstone. Anything else lacking explicit handling falls
// through to "none" too.

/**
 * Compute rail bot status from the legacy DetectedAgent list.
 * Preserved for backward compatibility — existing tests and callers
 * that pass `agentsStore` data continue to work.
 */
export function rootRailBotStatus(
  root: RootWorkspace,
  agents: DetectedAgent[],
): RailBotStatus {
  const ids = new Set([root.id, ...root.branchedWorkspaceIds]);
  let sawThinking = false;
  let sawIdle = false;
  for (const agent of agents) {
    if (!ids.has(agent.workspaceId)) continue;
    if (agent.status === "waiting") return "attention";
    if (THINKING_STATUSES.has(agent.status)) sawThinking = true;
    else if (IDLE_STATUSES.has(agent.status)) sawIdle = true;
  }
  if (sawThinking) return "thinking";
  if (sawIdle) return "idle";
  return "none";
}

/**
 * Attention-API-aware rail status computation.
 *
 * Consumes `AttentionEvent[]` from the Attention API (cycle-5) and a
 * set of paneIds that belong to the root + its branches. Any pane with
 * an active `awaiting_input` or `errored` event in the attention store
 * maps to "attention"; all other cases defer to the legacy path.
 *
 * This is the migration target for callers that have access to paneIds
 * keyed by workspace membership. The legacy `rootRailBotStatus` remains
 * for callers that still use `DetectedAgent[]`.
 */
export function rootRailBotStatusFromAttention(
  root: RootWorkspace,
  agents: DetectedAgent[],
  attentionEvents: AttentionEvent[],
  paneIdsByWorkspaceId: Map<string, string[]>,
): RailBotStatus {
  // Collect all paneIds in scope for this root + its branches.
  const workspaceIds = new Set([root.id, ...root.branchedWorkspaceIds]);
  const scopedPaneIds = new Set<string>();
  for (const wsId of workspaceIds) {
    const panes = paneIdsByWorkspaceId.get(wsId) ?? [];
    for (const pId of panes) scopedPaneIds.add(pId);
  }

  // Check attention events for any pane in scope.
  for (const ev of attentionEvents) {
    if (
      scopedPaneIds.has(ev.paneId) &&
      (ev.kind === "awaiting_input" ||
        ev.kind === "notify" ||
        ev.kind === "errored")
    ) {
      return "attention";
    }
  }

  // Fall back to legacy agent status for thinking / idle signals.
  return rootRailBotStatus(root, agents);
}
