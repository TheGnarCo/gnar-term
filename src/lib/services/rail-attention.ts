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

export type RailBotStatus = "none" | "thinking" | "attention" | "idle";

const THINKING_STATUSES = new Set(["running", "active"]);
const IDLE_STATUSES = new Set(["idle", "done"]);
// "closed" means the agent process is gone — don't paint a hat for
// a tombstone. Anything else lacking explicit handling falls
// through to "none" too.

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
