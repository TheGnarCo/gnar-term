/**
 * Rail bot status — pure aggregator that decides whether a Root
 * workspace's collapsed-mode rail should paint a status hat and which
 * variant. Mirrors the buildAgentRows pattern (pure, store-free,
 * vitest-testable). Scope is intentionally Root + all branches, in
 * contrast to WorkspaceSectionContent's banner-level workspaceBotStatus,
 * which is root-only.
 *
 *   - "attention": at least one agent in the tree is waiting → yellow
 *                  pulsing hat (highest priority — supersedes thinking).
 *   - "thinking":  no waiting agents, but at least one is actively
 *                  working (running or active) → green static hat.
 *   - "none":      no agents in the tree, or all are idle/done/closed
 *                  → no hat painted.
 */
import type { DetectedAgent } from "./agent-detection-service";
import type { RootWorkspace } from "../config";

export type RailBotStatus = "none" | "thinking" | "attention";

const THINKING_STATUSES = new Set(["running", "active"]);

export function rootRailBotStatus(
  root: RootWorkspace,
  agents: DetectedAgent[],
): RailBotStatus {
  const ids = new Set([root.id, ...root.branchedWorkspaceIds]);
  let sawThinking = false;
  for (const agent of agents) {
    if (!ids.has(agent.workspaceId)) continue;
    if (agent.status === "waiting") return "attention";
    if (THINKING_STATUSES.has(agent.status)) sawThinking = true;
  }
  return sawThinking ? "thinking" : "none";
}
