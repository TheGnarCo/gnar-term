/**
 * Rail attention — pure aggregator that decides whether a Root
 * workspace's collapsed-mode rail should paint the "needs attention"
 * hat. Mirrors the buildAgentRows pattern (pure, store-free, vitest-
 * testable). Scope is intentionally Root + all branches, in contrast
 * to WorkspaceSectionContent's banner-level workspaceBotStatus, which
 * is root-only.
 */
import type { DetectedAgent } from "./agent-detection-service";
import type { RootWorkspace } from "../config";

export function rootNeedsRailAttention(
  root: RootWorkspace,
  agents: DetectedAgent[],
): boolean {
  const ids = new Set([root.id, ...root.branchedWorkspaceIds]);
  return agents.some((a) => ids.has(a.workspaceId) && a.status === "waiting");
}
