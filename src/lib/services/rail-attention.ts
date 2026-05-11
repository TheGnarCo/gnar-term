/**
 * Rail bot status — pure aggregator that decides whether a workspace
 * row's rail should paint a status hat and which variant. The hat
 * renders at every sidebar width (collapsed and expanded) since
 * it's the canonical bot-notification surface. Mirrors the
 * buildAgentRows pattern (pure, store-free, vitest-testable).
 *
 *   - "attention": an in-scope pane has an active attention event
 *                  (awaiting_input / errored / notify), OR an
 *                  in-scope agent is in the "waiting" status →
 *                  yellow pulsing hat (highest priority).
 *   - "thinking":  no attention, but at least one in-scope agent
 *                  is actively working (running or active) →
 *                  green static hat.
 *   - "idle":      no thinking/attention, but at least one in-scope
 *                  agent is present (idle or done) → muted-grey
 *                  static hat. Surfaces "agent attached, currently
 *                  thinking" so presence is never invisible.
 *   - "none":      no agents in the tree → no hat painted.
 *
 * `rootRailBotStatus` aggregates Root + all branches (used by the
 * SidebarBanner rail). `workspaceRailBotStatus` aggregates a single
 * workspace (used by WorkspaceItem rows for per-branch hats).
 */
import type { DetectedAgent } from "./agent-detection-service";
import type { RootWorkspace } from "../config";
import type { AttentionEvent } from "./attention-api";

export type RailBotStatus = "none" | "thinking" | "attention" | "idle";

const THINKING_STATUSES = new Set(["running", "active"]);
const IDLE_STATUSES = new Set(["idle", "done"]);
const ATTENTION_KINDS = new Set(["awaiting_input", "errored", "notify"]);
// "closed" means the agent process is gone — don't paint a hat for
// a tombstone. Anything else lacking explicit handling falls
// through to "none" too.

/**
 * Core aggregator. Decides the hat variant for an arbitrary set of
 * workspace ids and their associated pane ids. Both `rootRailBotStatus`
 * and `workspaceRailBotStatus` are thin scope-building wrappers around
 * this function so per-row and per-section signals stay consistent.
 */
function computeRailBotStatus(
  workspaceIds: ReadonlySet<string>,
  scopedPaneIds: ReadonlySet<string>,
  agents: DetectedAgent[],
  attentionEvents: AttentionEvent[],
): RailBotStatus {
  for (const ev of attentionEvents) {
    if (scopedPaneIds.has(ev.paneId) && ATTENTION_KINDS.has(ev.kind)) {
      return "attention";
    }
  }

  let sawThinking = false;
  let sawIdle = false;
  for (const agent of agents) {
    if (!workspaceIds.has(agent.workspaceId)) continue;
    if (agent.status === "waiting") return "attention";
    if (THINKING_STATUSES.has(agent.status)) sawThinking = true;
    else if (IDLE_STATUSES.has(agent.status)) sawIdle = true;
  }
  if (sawThinking) return "thinking";
  if (sawIdle) return "idle";
  return "none";
}

/**
 * Compute the rail bot status for a Root workspace. Consumes both the
 * Attention API (cycle-5) and the `DetectedAgent[]` runtime list, so
 * OSC-driven attention events light the hat with "attention" before
 * the slower `DetectedAgent.status="waiting"` flip would.
 */
export function rootRailBotStatus(
  root: RootWorkspace,
  agents: DetectedAgent[],
  attentionEvents: AttentionEvent[],
  paneIdsByWorkspaceId: Map<string, string[]>,
): RailBotStatus {
  const workspaceIds = new Set([root.id, ...root.branchedWorkspaceIds]);
  const scopedPaneIds = new Set<string>();
  for (const wsId of workspaceIds) {
    const panes = paneIdsByWorkspaceId.get(wsId) ?? [];
    for (const pId of panes) scopedPaneIds.add(pId);
  }
  return computeRailBotStatus(
    workspaceIds,
    scopedPaneIds,
    agents,
    attentionEvents,
  );
}

/**
 * Compute the rail bot status for a single workspace (used by
 * WorkspaceItem rows). Same precedence as `rootRailBotStatus`, scoped
 * to one workspace + its panes — so a Branch row shows attention only
 * for events tied to its own panes/agents.
 */
export function workspaceRailBotStatus(
  workspaceId: string,
  paneIds: ReadonlyArray<string>,
  agents: DetectedAgent[],
  attentionEvents: AttentionEvent[],
): RailBotStatus {
  return computeRailBotStatus(
    new Set([workspaceId]),
    new Set(paneIds),
    agents,
    attentionEvents,
  );
}
