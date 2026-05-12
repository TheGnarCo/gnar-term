/**
 * branch-lifecycle-derive — pure derivation of lifecycle state from canonical
 * inputs. No store reads, no I/O. The store layer resolves paneId → agent
 * state (from either the live store or a test override) and passes it in.
 *
 * Lifecycle table (from ADR-0004):
 *
 * | Output state       | Inputs                                                           |
 * |--------------------|------------------------------------------------------------------|
 * | `draft`            | git: no commits OR only WIP commits; PR: none                    |
 * | `active`           | AgentState: `running` in the Branch's pane                       |
 * | `awaiting_review`  | git: commits present; AgentState: not running; PR: none/draft    |
 * | `in_review`        | PR: open, non-draft                                              |
 * | `merged`           | PR: merged                                                       |
 * | `abandoned`        | git: no activity > N days; PR: none; AgentState: idle            |
 *
 * When `gh` is unavailable: `in_review` / `merged` collapse to
 * `awaiting_review`, and `prStateKnown` is set to `false`.
 */

import type { AgentState } from "./agent-state";

export type BranchLifecycle =
  | "draft"
  | "active"
  | "awaiting_review"
  | "in_review"
  | "merged"
  | "abandoned";

export interface BranchLifecycleEntry {
  lifecycle: BranchLifecycle;
  /**
   * Whether the PR state could be determined.
   * `false` when `gh` is unavailable, so UI can show an appropriate hint.
   */
  prStateKnown: boolean;
  /** Unix millisecond timestamp of the most recent detected activity. */
  lastActivityAt: number;
  /** Optional human-readable explanation of why this lifecycle was computed. */
  reason?: string;
}

/**
 * PR state snapshot used for lifecycle derivation.
 * Null when no PR exists for the branch.
 */
export interface PrState {
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  merged: boolean;
}

/**
 * Injected provider for PR state. Accepts a repoPath + branch and returns
 * the current PR state (or null when no PR exists).
 *
 * The real implementation calls `invoke("gh_list_prs", ...)`.
 * Tests inject a stub that returns pre-baked values synchronously.
 */
export type PrStateProvider = (
  repoPath: string,
  branch: string,
) => Promise<PrState | null>;

const WIP_PREFIXES = ["wip:", "wip(", "wip ", "[wip]"];

export function isWipMessage(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return WIP_PREFIXES.some((p) => lower.startsWith(p));
}

export interface DerivationInputs {
  hasCommits: boolean;
  wipOnly: boolean;
  paneId: string | null;
  /**
   * Resolved agent state for the branch's pane (or undefined when no pane,
   * or no state recorded). The store layer is responsible for resolving
   * paneId → state — checking the test override map first, then the live
   * paneAgentStateStore — so this function stays pure.
   */
  paneAgentState: AgentState | undefined;
  prState: PrState | null;
  lastActivityAt: number;
  ghAvailable: boolean;
  abandonedAfterDays: number;
}

export function deriveLifecycle(
  inputs: DerivationInputs,
): BranchLifecycleEntry {
  const {
    hasCommits,
    wipOnly,
    paneId,
    paneAgentState,
    prState,
    lastActivityAt,
    ghAvailable,
    abandonedAfterDays,
  } = inputs;

  const prStateKnown = ghAvailable;
  const collapsePrState = !ghAvailable && prState !== null;

  if (ghAvailable && prState?.merged) {
    return { lifecycle: "merged", prStateKnown: true, lastActivityAt };
  }

  if (ghAvailable && prState?.state === "OPEN" && !prState.isDraft) {
    return { lifecycle: "in_review", prStateKnown: true, lastActivityAt };
  }

  if (paneId !== null && paneAgentState === "running") {
    return { lifecycle: "active", prStateKnown, lastActivityAt };
  }

  const now = Date.now();
  const abandonedThresholdMs = abandonedAfterDays * 24 * 60 * 60 * 1000;
  const isStale = now - lastActivityAt > abandonedThresholdMs;
  const noPrOrGhDown = prState === null || !ghAvailable;
  if (isStale && noPrOrGhDown) {
    return {
      lifecycle: "abandoned",
      prStateKnown,
      lastActivityAt,
      reason: `No activity for ${abandonedAfterDays}+ days`,
    };
  }

  const isDraftBranch = !hasCommits || wipOnly;
  if (isDraftBranch) {
    return {
      lifecycle: "draft",
      prStateKnown,
      lastActivityAt,
    };
  }

  return {
    lifecycle: "awaiting_review",
    prStateKnown: collapsePrState ? false : prStateKnown,
    lastActivityAt,
  };
}
